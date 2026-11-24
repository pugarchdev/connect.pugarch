  import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import ChatbotFlow from '../models/ChatbotFlow';
import CompanyWhatsAppConfig from '../models/CompanyWhatsAppConfig';
import { authenticate } from '../middleware/auth';
import { requireSuperAdmin } from '../middleware/rbac';
import { logger } from '../config/logger';
import { generateDefaultFlows, hasDefaultFlows } from '../services/defaultFlowGenerator';
import { FlowCacheService } from '../services/flowCacheService';
import {
  WHATSAPP_LIMITS_BUTTONS,
  WHATSAPP_LIMITS_LIST
} from '../config/whatsappLimits';

const router = express.Router();

/** Validate step against WhatsApp Business API limits. Returns error message or null. */
function validateStepWhatsAppLimits(step: any, index: number): string | null {
  const stepLabel = `Step ${index + 1} (${step.stepId || 'unknown'})`;
  if (step.stepType === 'buttons' && step.buttons?.length) {
    if (step.buttons.length > WHATSAPP_LIMITS_BUTTONS.MAX_BUTTONS_PER_MESSAGE) {
      return `${stepLabel}: WhatsApp allows max ${WHATSAPP_LIMITS_BUTTONS.MAX_BUTTONS_PER_MESSAGE} buttons per message. You have ${step.buttons.length}. Chain steps instead.`;
    }
    for (let i = 0; i < step.buttons.length; i++) {
      const title = (step.buttons[i].title || '').trim();
      if (title.length > WHATSAPP_LIMITS_BUTTONS.BUTTON_TITLE_MAX_LENGTH) {
        return `${stepLabel}: Button "${title.slice(0, 15)}..." exceeds ${WHATSAPP_LIMITS_BUTTONS.BUTTON_TITLE_MAX_LENGTH} characters.`;
      }
    }
  }
  if (step.stepType === 'list' && step.listConfig?.sections?.length) {
    if (step.listConfig.sections.length > WHATSAPP_LIMITS_LIST.MAX_SECTIONS_PER_LIST) {
      return `${stepLabel}: WhatsApp allows max ${WHATSAPP_LIMITS_LIST.MAX_SECTIONS_PER_LIST} section per list.`;
    }
    for (const section of step.listConfig.sections) {
      const sectionTitle = (section.title || '').trim();
      if (sectionTitle.length > WHATSAPP_LIMITS_LIST.SECTION_TITLE_MAX_LENGTH) {
        return `${stepLabel}: Section title exceeds ${WHATSAPP_LIMITS_LIST.SECTION_TITLE_MAX_LENGTH} characters.`;
      }
      if (section.rows?.length > WHATSAPP_LIMITS_LIST.MAX_ROWS_PER_SECTION) {
        return `${stepLabel}: WhatsApp allows max ${WHATSAPP_LIMITS_LIST.MAX_ROWS_PER_SECTION} rows per section. You have ${section.rows.length}. Use pagination or dynamic departments.`;
      }
      for (const row of section.rows || []) {
        const rowTitle = (row.title || '').trim();
        const rowDesc = (row.description || '').trim();
        if (rowTitle.length > WHATSAPP_LIMITS_LIST.ROW_TITLE_MAX_LENGTH) {
          return `${stepLabel}: List row title exceeds ${WHATSAPP_LIMITS_LIST.ROW_TITLE_MAX_LENGTH} characters.`;
        }
        if (rowDesc.length > WHATSAPP_LIMITS_LIST.ROW_DESCRIPTION_MAX_LENGTH) {
          return `${stepLabel}: List row description exceeds ${WHATSAPP_LIMITS_LIST.ROW_DESCRIPTION_MAX_LENGTH} characters.`;
        }
      }
    }
  }
  return null;
}

/**
 * @route   GET /api/chatbot-flows
 * @desc    Get all chatbot flows (superadmin can see all, company admin sees their own)
 * @access  Private
 */
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { companyId, flowType, isActive } = req.query;
    const user = (req as any).user;

    const query: any = {};

    // If not superadmin, filter by user's company
    if (!user.isSuperAdmin && user.companyId) {
      query.companyId = user.companyId;
    } else if (companyId) {
      // Convert string companyId to ObjectId if valid
      if (mongoose.Types.ObjectId.isValid(companyId as string)) {
        query.companyId = new mongoose.Types.ObjectId(companyId as string);
      } else {
        query.companyId = companyId;
      }
    }

    if (flowType) query.flowType = flowType;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const flows = await ChatbotFlow.find(query)
      .select('-nodes -edges') // Exclude large architecture fields for list view
      .populate('companyId', 'name companyId')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    logger.info(`📊 Found ${flows.length} flow(s) for company: ${companyId || 'all'}`);

    res.json({
      success: true,
      data: flows
    });
  } catch (error: any) {
    logger.error('❌ Error fetching chatbot flows:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chatbot flows',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/chatbot-flows/:id
 * @desc    Get single chatbot flow by ID
 * @access  Private
 */
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid chatbot flow ID format'
      });
    }

    const flow = await ChatbotFlow.findById(id)
      .populate('companyId', 'name companyId')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!flow) {
      return res.status(404).json({
        success: false,
        message: 'Chatbot flow not found'
      });
    }

    // Check access - non-SUPER_ADMIN users can only view flows from their own company
    if (!user.isSuperAdmin) {
      const flowCompanyId = flow.companyId?._id?.toString() || flow.companyId?.toString();
      const userCompanyId = user.companyId?.toString();
      
      if (flowCompanyId !== userCompanyId) {
        logger.warn(`⚠️  Unauthorized access attempt: User ${user.userId} (Company: ${userCompanyId}) tried to access flow ${flow.flowId} (Company: ${flowCompanyId})`);
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only view flows from your own company'
        });
      }
    }

    res.json({
      success: true,
      data: flow
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chatbot flow',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/chatbot-flows
 * @desc    Create new chatbot flow (superadmin only)
 * @access  Private/SuperAdmin
 */
router.post('/', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    logger.info('📝 Creating chatbot flow - Request received');
    logger.info('Request body keys:', Object.keys(req.body));
    if (req.body.steps && req.body.steps.length > 0) {
      logger.info('First step sample:', JSON.stringify(req.body.steps[0], null, 2));
    }
    
    // Transform frontend data to match backend model
    const { 
      name, 
      flowName, 
      description, 
      flowDescription, 
      companyId, 
      trigger, 
      triggers, 
      steps, 
      version, 
      isActive,
      isPreTransformed,
      nodes,
      edges
    } = req.body;
    
    const finalName = name || flowName;
    const finalDescription = description || flowDescription;
    
    // Validate required fields
    if (!finalName || !finalName.trim()) {
      logger.error('❌ Validation failed: Flow name is required');
      return res.status(400).json({
        success: false,
        message: 'Flow name is required'
      });
    }
    
    if (!companyId) {
      logger.error('❌ Validation failed: Company ID is required');
      return res.status(400).json({
        success: false,
        message: 'Company ID is required'
      });
    }
    
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      logger.error('❌ Validation failed: At least one step is required');
      return res.status(400).json({
        success: false,
        message: 'At least one step is required'
      });
    }
    
    logger.info(`✅ Validated: name="${name}", companyId="${companyId}", steps=${steps.length}`);
    
    // Determine flow type from name or default to 'custom'
    let flowType = 'custom';
    const nameLower = (finalName || '').toLowerCase();
    if (nameLower.includes('grievance')) flowType = 'grievance';
    else if (nameLower.includes('appointment')) flowType = 'appointment';
    else if (nameLower.includes('track')) flowType = 'tracking';
    
    logger.info(`✅ Flow type determined: ${flowType}`);
    
    // Transform steps to match backend model
    let transformedSteps = steps;
    if (!isPreTransformed && steps && Array.isArray(steps)) {
      transformedSteps = steps.map((step: any, index: number) => {
      // 🕵️ Get stepId (support both 'stepId' and React Flow 'id')
      const stepId = step.stepId || step.id;
      
      // Validate step has required fields
      if (!stepId || !stepId.toString().trim()) {
        throw new Error(`Step ${index + 1} is missing or has empty stepId`);
      }
      
      // 🕵️ Get type (support both 'type' and 'stepType')
      const type = step.type || step.stepType;
      
      if (!type || !type.toString().trim()) {
        throw new Error(`Step ${index + 1} (${stepId}) is missing or has empty type`);
      }
      
      // Clean stepId
      const cleanStepId = stepId.toString().trim();
      
      // Map frontend step types to backend step types
      let stepType = type.toString().trim();
      if (stepType === 'interactive_buttons' || stepType === 'buttonMessage') stepType = 'buttons';
      else if (stepType === 'interactive_list' || stepType === 'listMessage') stepType = 'list';
      else if (stepType === 'collect_input' || stepType === 'userInput') stepType = 'input';
      else if (stepType === 'textMessage') stepType = 'message';
      else if (stepType === 'apiCall') stepType = 'api_call';
      else if (stepType === 'dynamic_availability') stepType = 'api_call'; 
      
      // Ensure stepName is always a valid non-empty string
      const stepName = cleanStepId || `Step_${index + 1}`;
      
      const transformedStep: any = {
        stepId: cleanStepId,
        stepType: stepType,
        stepName: stepName, // Always a valid string
        nextStepId: step.nextStep ? step.nextStep.toString().trim() : null
      };
      
      // Add message text (required for most step types)
      if (step.content?.text?.en) {
        transformedStep.messageText = step.content.text.en;
      } else if (step.content?.text) {
        transformedStep.messageText = typeof step.content.text === 'string' ? step.content.text : '';
      } else {
        transformedStep.messageText = ''; // Empty string for steps without text
      }
      
      // Add buttons
      if (step.content?.buttons && Array.isArray(step.content.buttons) && step.content.buttons.length > 0) {
        transformedStep.buttons = step.content.buttons
          .filter((btn: any) => btn && btn.id) // Filter out invalid buttons
          .map((btn: any) => ({
            id: btn.id || '',
            title: btn.text?.en || btn.text || btn.title || '',
            description: btn.description || '',
            nextStepId: btn.nextStepId || step.nextStep || null,
            action: 'next'
          }));
      }

      // Add list config (for list step type): manual sections or dynamic departments
      if (stepType === 'list') {
        const listSource = step.content?.listSource === 'departments' ? 'departments' : 'manual';
        const buttonText = step.content?.listButtonText || step.content?.buttonText || 'Select';
        if (listSource === 'departments') {
          transformedStep.listConfig = {
            listSource: 'departments',
            buttonText,
            sections: []
          };
        } else if (step.content?.buttons && Array.isArray(step.content.buttons) && step.content.buttons.length > 0) {
          transformedStep.listConfig = {
            listSource: 'manual',
            buttonText,
            sections: [{
              title: step.content?.listSectionTitle || 'Options',
              rows: step.content.buttons
                .filter((btn: any) => btn && btn.id)
                .map((btn: any) => ({
                  id: btn.id || '',
                  title: (btn.text?.en || btn.text || btn.title || '').substring(0, 24),
                  description: (btn.description || '').substring(0, 72),
                  nextStepId: btn.nextStepId || step.nextStep || null
                }))
            }]
          };
        } else {
          transformedStep.listConfig = { listSource: 'manual', buttonText, sections: [] };
        }
      }

      // Add input config (nextStepId from Default Next Step OR step.nextStepId OR from Expected Response "Next Step ID when this response is received")
      if (step.content?.inputConfig && step.content.inputConfig.saveToField) {
        const firstRespWithNext = step.expectedResponses && step.expectedResponses.find((r: any) => r.nextStepId && String(r.nextStepId).trim());
        const defaultNext = (step.nextStep && String(step.nextStep).trim()) || (step.nextStepId && String(step.nextStepId).trim()) || null;
        const inputNextStep = defaultNext || (firstRespWithNext ? String(firstRespWithNext.nextStepId).trim() : null);
        transformedStep.inputConfig = {
          inputType: step.content.inputConfig.inputType || 'text',
          validation: {
            required: step.content.inputConfig.validation?.required || false,
            minLength: step.content.inputConfig.validation?.minLength || undefined,
            maxLength: step.content.inputConfig.validation?.maxLength || undefined
          },
          placeholder: step.content.inputConfig.placeholder || '',
          saveToField: step.content.inputConfig.saveToField || '',
          nextStepId: inputNextStep
        };
      }
      
      // Add availability config as api_call config (body must match /api/availability/chatbot/:companyId query: daysAhead, selectedDate, departmentId)
      if (step.content?.availabilityConfig && step.content.availabilityConfig.saveToField) {
        const av = step.content.availabilityConfig;
        const type = av.type || 'date';
        const dateRange = av.dateRange || { startDays: 0, endDays: 30 };
        const departmentId = av.departmentId ?? null;
        const body: Record<string, string | number | null> =
          type === 'time'
            ? { selectedDate: '{appointmentDate}', departmentId: departmentId ? String(departmentId) : null }
            : { daysAhead: String(dateRange.endDays ?? 30), departmentId: departmentId ? String(departmentId) : null };
        transformedStep.apiConfig = {
          method: 'GET',
          endpoint: `/api/availability/chatbot/${companyId}`,
          headers: {},
          body,
          saveResponseTo: av.saveToField || '',
          nextStepId: step.nextStep || null
        };
      }
      
      // Add expected responses/triggers for routing
      if (step.expectedResponses && Array.isArray(step.expectedResponses) && step.expectedResponses.length > 0) {
        transformedStep.expectedResponses = step.expectedResponses
          .filter((resp: any) => {
            // Filter out invalid responses
            if (!resp || !resp.type) return false;
            // For 'any' type, always include. For others, require a value
            if (resp.type === 'any') return true;
            return resp.value && resp.value.trim().length > 0;
          })
          .map((resp: any) => ({
            type: resp.type || 'text',
            value: resp.type === 'any' ? '*' : (resp.value || '').trim(),
            nextStepId: resp.nextStepId && resp.nextStepId.trim() ? resp.nextStepId.trim() : undefined
          }));
        
        // Only add if we have valid responses after filtering
        if (transformedStep.expectedResponses.length === 0) {
          delete transformedStep.expectedResponses;
        }
      }
      
      return transformedStep;
    });
    }
    
    logger.info(`✅ Transformed ${transformedSteps.length} steps`);

    // ✅ CRITICAL: Process EDGES to inject button routing into expectedResponses.
    // The JSON flow uses edges with `sourceHandle` = button ID to define routing.
    // Without this, button clicks from the JSON flow have no routing information.
    if (edges && Array.isArray(edges) && edges.length > 0) {
      logger.info(`🔗 Processing ${edges.length} edge(s) to inject button routing...`);
      
      for (const edge of edges) {
        if (!edge.source || !edge.target) continue;
        
        const sourceStep = transformedSteps.find((s: any) => s.stepId === edge.source);
        if (!sourceStep) continue;
        
        if (edge.sourceHandle) {
          // Edge with a sourceHandle = button click routing
          // Set as an expectedResponse on the source step
          if (!sourceStep.expectedResponses) sourceStep.expectedResponses = [];
          
          // Avoid duplicates
          const alreadyExists = sourceStep.expectedResponses.some(
            (er: any) => er.type === 'button_click' && er.value === edge.sourceHandle
          );
          if (!alreadyExists) {
            sourceStep.expectedResponses.push({
              type: 'button_click',
              value: edge.sourceHandle,
              nextStepId: edge.target
            });
          }
          
          // Also ensure button objects have nextStepId set (used for buttonMapping fallback)
          if (sourceStep.buttons && Array.isArray(sourceStep.buttons)) {
            const matchingBtn = sourceStep.buttons.find((b: any) => b.id === edge.sourceHandle);
            if (matchingBtn) {
              matchingBtn.nextStepId = edge.target;
            }
          }
        } else {
          // Edge without sourceHandle = direct step transition (auto-advance)
          // Only set nextStepId if not already set
          if (!sourceStep.nextStepId) {
            sourceStep.nextStepId = edge.target;
          }
        }
      }
      logger.info(`✅ Edge processing complete. Button routing injected into steps.`);
    }

    // Validate WhatsApp Business API limits
    for (let i = 0; i < transformedSteps.length; i++) {
      const err = validateStepWhatsAppLimits(transformedSteps[i], i);
      if (err) {
        return res.status(400).json({ success: false, message: err });
      }
    }
    
    // Get first step ID as startStepId (use cleaned stepId from transformed steps)
    const startStepId = transformedSteps.length > 0 ? transformedSteps[0].stepId : 'step_1';
    
    // Transform trigger(s) to triggers array
    // Support both old format (single trigger) and new format (triggers array)
    let transformedTriggers: any[] = [];
    
    if (isPreTransformed && triggers) {
      transformedTriggers = triggers;
    } else if (triggers && Array.isArray(triggers) && triggers.length > 0) {
      // New format: multiple triggers
      transformedTriggers = triggers
        .filter((t: any) => t && t.value && t.value.trim()) // Filter out empty triggers
        .map((t: any) => ({
          triggerType: t.type === 'message' ? 'keyword' : (t.type || 'keyword'),
          triggerValue: t.value.trim(),
          startStepId: t.startStepId || startStepId
        }));
    } else if (trigger && trigger.value) {
      // Old format: single trigger (backward compatibility)
      transformedTriggers = [{
        triggerType: trigger.type === 'message' ? 'keyword' : trigger.type || 'keyword',
        triggerValue: trigger.value.trim(),
        startStepId: startStepId
      }];
    } else {
      // Default: no triggers provided, use default
      transformedTriggers = [{
        triggerType: 'keyword',
        triggerValue: 'hi',
        startStepId: startStepId
      }];
    }
    
    // Validate at least one trigger
    if (transformedTriggers.length === 0) {
      logger.error('❌ Validation failed: At least one trigger is required');
      return res.status(400).json({
        success: false,
        message: 'At least one trigger is required'
      });
    }
    
    // Convert companyId to ObjectId if it's a string
    let companyObjectId;
    if (mongoose.Types.ObjectId.isValid(companyId)) {
      companyObjectId = new mongoose.Types.ObjectId(companyId);
    } else {
      logger.error(`❌ Invalid companyId format: ${companyId}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid company ID format'
      });
    }
    
    const flowData = {
      companyId: companyObjectId,
      flowName: finalName || 'Untitled Flow',
      flowDescription: finalDescription || '',
      flowType: flowType,
      startStepId: startStepId,
      steps: transformedSteps,
      triggers: transformedTriggers,
      version: version || 1,
      isActive: isActive || false,
      createdBy: user._id,
      nodes: nodes || [],
      edges: edges || []
    };

    logger.info('📝 Creating flow with data:', JSON.stringify({
      flowName: flowData.flowName,
      flowType: flowData.flowType,
      startStepId: flowData.startStepId,
      stepsCount: flowData.steps.length,
      triggersCount: flowData.triggers.length,
      companyId: flowData.companyId.toString()
    }, null, 2));

    const flow = await ChatbotFlow.create(flowData);
    await FlowCacheService.invalidateCompanyCache(flow.companyId.toString());
    
    logger.info(`✅ Flow created successfully: ${flow.flowId}`);

    res.status(201).json({
      success: true,
      message: 'Chatbot flow created successfully',
      data: flow
    });
  } catch (error: any) {
    logger.error('❌ Error creating chatbot flow:', error);
    logger.error('❌ Error name:', error.name);
    logger.error('❌ Error message:', error.message);
    
    if (error.errors) {
      logger.error('❌ Validation errors:', JSON.stringify(error.errors, null, 2));
    }
    
    if (error.stack) {
      logger.error('❌ Error stack:', error.stack);
    }
    
    // Return more detailed error information
    if (error.name === 'ValidationError') {
      const validationErrors: any = {};
      if (error.errors) {
        Object.keys(error.errors).forEach(key => {
          validationErrors[key] = error.errors[key].message;
        });
      }
      
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        error: error.message,
        validationErrors: validationErrors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create chatbot flow',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * @route   PUT /api/chatbot-flows/:id
 * @desc    Update chatbot flow (superadmin only)
 * @access  Private/SuperAdmin
 */
router.put('/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { 
      name, flowName, description, flowDescription, steps, 
      version, isActive, triggers, trigger, isPreTransformed,
      nodes, edges
    } = req.body;
    
    const finalName = name || flowName;
    const finalDescription = description || flowDescription;

    logger.info(`📝 Updating chatbot flow: ${req.params.id}`);
    
    const flow = await ChatbotFlow.findById(req.params.id);
    if (!flow) {
      return res.status(404).json({
        success: false,
        message: 'Chatbot flow not found'
      });
    }

    // Validate required fields
    if (finalName && !finalName.trim()) {
      logger.error('❌ Validation failed: Flow name cannot be empty');
      return res.status(400).json({
        success: false,
        message: 'Flow name cannot be empty'
      });
    }

    // Transformation logic
    let transformedSteps = flow.steps;
    if (isPreTransformed && steps) {
      transformedSteps = steps;
    } else if (steps && Array.isArray(steps) && steps.length > 0) {
      transformedSteps = steps.map((step: any, index: number) => {
        // 🕵️ Get stepId (support both 'stepId' and React Flow 'id')
        const stepId = step.stepId || step.id;

        // Validate step has required fields
        if (!stepId || !stepId.toString().trim()) {
          throw new Error(`Step ${index + 1} is missing or has empty stepId`);
        }

        // Clean stepId
        const cleanStepId = stepId.toString().trim();
        
        // 🕵️ Get type (support both 'type' and 'stepType')
        const type = step.type || step.stepType;
        
        if (!type || !type.toString().trim()) {
          throw new Error(`Step ${index + 1} (${cleanStepId}) is missing or has empty type`);
        }

        // Map frontend step types to backend step types (SAME AS POST ROUTE)
        let stepType = type.toString().trim();
        if (stepType === 'interactive_buttons' || stepType === 'buttonMessage') stepType = 'buttons';
        else if (stepType === 'interactive_list' || stepType === 'listMessage') stepType = 'list';
        else if (stepType === 'collect_input' || stepType === 'userInput') stepType = 'input';
        else if (stepType === 'textMessage') stepType = 'message';
        else if (stepType === 'apiCall') stepType = 'api_call';
        else if (stepType === 'dynamic_availability') stepType = 'api_call';
        // 'message' and 'media' stay as-is (they're valid in backend enum)
        
        // Ensure stepName is always a valid non-empty string
        const stepName = cleanStepId || `Step_${index + 1}`;

        const transformedStep: any = {
          stepId: cleanStepId,
          stepType: stepType,
          stepName: stepName,
          nextStepId: step.nextStep ? step.nextStep.toString().trim() : null
        };
        
        // Add message text (required for most step types)
        if (step.content?.text?.en) {
          transformedStep.messageText = step.content.text.en;
        } else if (step.content?.text) {
          transformedStep.messageText = typeof step.content.text === 'string' 
            ? step.content.text 
            : step.content.text.en || '';
        } else {
          transformedStep.messageText = ''; // Empty string for steps without text
        }

        // Add buttons
        if (step.content?.buttons && Array.isArray(step.content.buttons) && step.content.buttons.length > 0) {
          transformedStep.buttons = step.content.buttons
            .filter((btn: any) => btn && btn.id)
            .map((btn: any) => ({
              id: btn.id || '',
              title: btn.text?.en || btn.text || btn.title || '',
              description: btn.description || '',
              nextStepId: btn.nextStepId || step.nextStep || null,
              action: 'next'
            }));
        }

        // Add list config (for list step type)
        if (stepType === 'list') {
          const listSource = step.content?.listSource === 'departments' ? 'departments' : 'manual';
          const buttonText = step.content?.listButtonText || step.content?.buttonText || 'Select';
          if (listSource === 'departments') {
            transformedStep.listConfig = {
              listSource: 'departments',
              buttonText,
              sections: []
            };
          } else if (step.content?.buttons && Array.isArray(step.content.buttons) && step.content.buttons.length > 0) {
            transformedStep.listConfig = {
              listSource: 'manual',
              buttonText,
              sections: [{
                title: step.content?.listSectionTitle || 'Options',
                rows: step.content.buttons
                  .filter((btn: any) => btn && btn.id)
                  .map((btn: any) => ({
                    id: btn.id || '',
                    title: (btn.text?.en || btn.text || btn.title || '').substring(0, 24),
                    description: (btn.description || '').substring(0, 72),
                    nextStepId: btn.nextStepId || step.nextStep || null
                  }))
                }]
              };
          } else {
            transformedStep.listConfig = { listSource: 'manual', buttonText, sections: [] };
          }
        }
        
        // Add input config (nextStepId from Default Next Step OR step.nextStepId OR from Expected Response)
        if (step.content?.inputConfig && step.content.inputConfig.saveToField) {
          const firstRespWithNext = step.expectedResponses && step.expectedResponses.find((r: any) => r.nextStepId && String(r.nextStepId).trim());
          const defaultNext = (step.nextStep && String(step.nextStep).trim()) || (step.nextStepId && String(step.nextStepId).trim()) || null;
          const inputNextStep = defaultNext || (firstRespWithNext ? String(firstRespWithNext.nextStepId).trim() : null);
          transformedStep.inputConfig = {
            inputType: step.content.inputConfig.inputType || 'text',
            validation: {
              required: step.content.inputConfig.validation?.required || false,
              minLength: step.content.inputConfig.validation?.minLength || undefined,
              maxLength: step.content.inputConfig.validation?.maxLength || undefined
            },
            placeholder: step.content.inputConfig.placeholder || '',
            saveToField: step.content.inputConfig.saveToField || '',
            nextStepId: inputNextStep
          };
        }
        
        // Add availability config as api_call config (body must match /api/availability/chatbot/:companyId query)
        if (step.content?.availabilityConfig && step.content.availabilityConfig.saveToField) {
          const av = step.content.availabilityConfig;
          const type = av.type || 'date';
          const dateRange = av.dateRange || { startDays: 0, endDays: 30 };
          const departmentId = av.departmentId ?? null;
          const body: Record<string, string | number | null> =
            type === 'time'
              ? { selectedDate: '{appointmentDate}', departmentId: departmentId ? String(departmentId) : null }
              : { daysAhead: String(dateRange.endDays ?? 30), departmentId: departmentId ? String(departmentId) : null };
          transformedStep.apiConfig = {
            method: 'GET',
            endpoint: `/api/availability/chatbot/${flow.companyId}`,
            headers: {},
            body,
            saveResponseTo: av.saveToField || '',
            nextStepId: step.nextStep || null
          };
        }
        
        // Add expected responses/triggers for routing
        if (step.expectedResponses && Array.isArray(step.expectedResponses) && step.expectedResponses.length > 0) {
          transformedStep.expectedResponses = step.expectedResponses
            .filter((resp: any) => {
              // Filter out invalid responses
              if (!resp || !resp.type) return false;
              // For 'any' type, always include. For others, require a value
              if (resp.type === 'any') return true;
              return resp.value && resp.value.trim().length > 0;
            })
            .map((resp: any) => ({
              type: resp.type || 'text',
              value: resp.type === 'any' ? '*' : (resp.value || '').trim(),
              nextStepId: resp.nextStepId && resp.nextStepId.trim() ? resp.nextStepId.trim() : undefined
            }));
          
          // Only add if we have valid responses after filtering
          if (transformedStep.expectedResponses.length === 0) {
            delete transformedStep.expectedResponses;
          }
        }
        
        return transformedStep;
      });

      // Validate WhatsApp Business API limits
      for (let i = 0; i < transformedSteps.length; i++) {
        const err = validateStepWhatsAppLimits(transformedSteps[i], i);
        if (err) {
          return res.status(400).json({ success: false, message: err });
        }
      }

      // ✅ CRITICAL: Process EDGES to inject button routing into expectedResponses (same as POST route)
      if (edges && Array.isArray(edges) && edges.length > 0) {
        logger.info(`🔗 [PUT] Processing ${edges.length} edge(s) to inject button routing...`);
        for (const edge of edges) {
          if (!edge.source || !edge.target) continue;
          const sourceStep = transformedSteps.find((s: any) => s.stepId === edge.source);
          if (!sourceStep) continue;
          if (edge.sourceHandle) {
            if (!sourceStep.expectedResponses) sourceStep.expectedResponses = [];
            const alreadyExists = sourceStep.expectedResponses.some(
              (er: any) => er.type === 'button_click' && er.value === edge.sourceHandle
            );
            if (!alreadyExists) {
              sourceStep.expectedResponses.push({
                type: 'button_click',
                value: edge.sourceHandle,
                nextStepId: edge.target
              });
            }
            if (sourceStep.buttons && Array.isArray(sourceStep.buttons)) {
              const matchingBtn = sourceStep.buttons.find((b: any) => b.id === edge.sourceHandle);
              if (matchingBtn) matchingBtn.nextStepId = edge.target;
            }
          } else {
            if (!sourceStep.nextStepId) sourceStep.nextStepId = edge.target;
          }
        }
        logger.info(`✅ [PUT] Edge processing complete.`);
      }
    }

    // Transform triggers if provided
    let transformedTriggers = flow.triggers; // Keep existing triggers if not provided
    if (isPreTransformed && triggers) {
      transformedTriggers = triggers;
    } else if (triggers && Array.isArray(triggers) && triggers.length > 0) {
      const startStepId = transformedSteps.length > 0 ? transformedSteps[0].stepId : flow.startStepId;
      transformedTriggers = triggers
        .filter((t: any) => t && t.value && t.value.trim())
        .map((t: any) => ({
          triggerType: t.type === 'message' ? 'keyword' : (t.type || 'keyword'),
          triggerValue: t.value.trim(),
          startStepId: t.startStepId || startStepId
        }));
    } else if (trigger && trigger.value) { // Backward compatibility for single trigger
      const startStepId = transformedSteps.length > 0 ? transformedSteps[0].stepId : flow.startStepId;
      transformedTriggers = [{
        triggerType: trigger.type === 'message' ? 'keyword' : trigger.type || 'keyword',
        triggerValue: trigger.value.trim(),
        startStepId: trigger.startStepId || startStepId
      }];
    }

    // Update flow fields
    if (finalName !== undefined) flow.flowName = finalName.trim();
    if (finalDescription !== undefined) flow.flowDescription = finalDescription || '';
    if (steps !== undefined) { // Only update steps if provided in the request
      flow.steps = transformedSteps;
      // Update startStepId if steps were provided and transformed
      if (transformedSteps.length > 0) {
        flow.startStepId = transformedSteps[0].stepId;
      } else {
        flow.startStepId = 'step_1'; // Default if steps become empty
      }
    }
    if (triggers !== undefined || trigger !== undefined) { // Only update triggers if provided
      flow.triggers = transformedTriggers;
    }
    if (isActive !== undefined) flow.isActive = isActive;
    if (version !== undefined) flow.version = version;
    if (nodes !== undefined) flow.nodes = nodes;
    if (edges !== undefined) flow.edges = edges;
    
    flow.updatedBy = user._id;
    
    await flow.save();
    await FlowCacheService.invalidateCompanyCache(flow.companyId.toString());

    logger.info(`✅ Flow updated successfully: ${flow.flowId}`);

    res.json({
      success: true,
      message: 'Chatbot flow updated successfully',
      data: flow
    });
  } catch (error: any) {
    logger.error('❌ Error updating chatbot flow:', error);
    
    if (error.name === 'ValidationError') {
      const validationErrors: any = {};
      if (error.errors) {
        Object.keys(error.errors).forEach(key => {
          validationErrors[key] = error.errors[key].message;
        });
      }
      
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        error: error.message,
        validationErrors: validationErrors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update chatbot flow',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/chatbot-flows/:id
 * @desc    Permanently delete chatbot flow (superadmin only)
 * @access  Private/SuperAdmin
 */
router.delete('/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    logger.info(`🗑️ Permanently deleting chatbot flow: ${id}`);
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.error(`❌ Invalid flow ID format: ${id}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid flow ID format'
      });
    }
    
    // Find flow
    const flow = await ChatbotFlow.findById(id);
    
    if (!flow) {
      logger.error(`❌ Flow not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: 'Chatbot flow not found'
      });
    }

    // Also remove from WhatsApp config activeFlows if assigned
    try {
      const CompanyWhatsAppConfig = (await import('../models/CompanyWhatsAppConfig')).default;
      await CompanyWhatsAppConfig.updateMany(
        {},
        { $pull: { activeFlows: { flowId: new mongoose.Types.ObjectId(id) } } }
      );
      logger.info(`✅ Removed flow from all WhatsApp configs`);
    } catch (configError: any) {
      logger.warn(`⚠️ Could not remove flow from WhatsApp configs: ${configError.message}`);
      // Continue with deletion even if config update fails
    }

    // PERMANENT DELETE - Remove from database
    await ChatbotFlow.findByIdAndDelete(id);

    logger.info(`✅ Flow permanently deleted: ${flow.flowId || id}`);

    res.json({
      success: true,
      message: 'Chatbot flow permanently deleted successfully'
    });
  } catch (error: any) {
    logger.error('❌ Error deleting chatbot flow:', error);
    logger.error('Error details:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: 'Failed to delete chatbot flow',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/chatbot-flows/bulk-delete
 * @desc    Bulk delete chatbot flows (superadmin only)
 * @access  Private/SuperAdmin
 */
router.post('/bulk-delete', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of flow IDs to delete'
      });
    }

    logger.info(`🗑️ Bulk deleting ${ids.length} chatbot flows`);

    // Filter valid ObjectIds
    const validIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id));
    
    if (validIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid flow IDs provided'
      });
    }

    // Also remove from WhatsApp config activeFlows if assigned
    try {
      const CompanyWhatsAppConfig = (await import('../models/CompanyWhatsAppConfig')).default;
      await CompanyWhatsAppConfig.updateMany(
        {},
        { $pull: { activeFlows: { flowId: { $in: validIds.map(id => new mongoose.Types.ObjectId(id)) } } } }
      );
      logger.info(`✅ Removed ${validIds.length} flows from all WhatsApp configs`);
    } catch (configError: any) {
      logger.warn(`⚠️ Could not remove flows from WhatsApp configs: ${configError.message}`);
    }

    // Bulk delete from database
    const result = await ChatbotFlow.deleteMany({ _id: { $in: validIds } });

    logger.info(`✅ ${result.deletedCount} flows permanently deleted`);

    res.json({
      success: true,
      message: `${result.deletedCount} chatbot flow(s) deleted successfully`,
      data: { deletedCount: result.deletedCount }
    });
  } catch (error: any) {
    logger.error('❌ Error bulk deleting chatbot flows:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk delete chatbot flows',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/chatbot-flows/:id/duplicate
 * @desc    Duplicate a chatbot flow (superadmin only)
 * @access  Private/SuperAdmin
 */
router.post('/:id/duplicate', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const originalFlow = await ChatbotFlow.findById(req.params.id);
    
    if (!originalFlow) {
      return res.status(404).json({
        success: false,
        message: 'Chatbot flow not found'
      });
    }

    // Create duplicate
    const duplicateData: any = originalFlow.toObject();
    delete duplicateData._id;
    delete duplicateData.flowId;
    delete duplicateData.createdAt;
    delete duplicateData.updatedAt;
    
    duplicateData.flowName = `${originalFlow.flowName} (Copy)`;
    duplicateData.version = 1;
    duplicateData.isActive = false;
    duplicateData.createdBy = user._id;
    duplicateData.updatedBy = user._id;

    const duplicate = await ChatbotFlow.create(duplicateData);

    res.json({
      success: true,
      message: 'Flow duplicated successfully',
      data: duplicate
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to duplicate flow',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/chatbot-flows/:id/activate
 * @desc    Activate a chatbot flow (deactivates others for same company)
 * @access  Private/SuperAdmin
 */
router.post('/:id/activate', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid chatbot flow ID format'
      });
    }

    const flow = await ChatbotFlow.findById(id);
    
    if (!flow) {
      return res.status(404).json({
        success: false,
        message: 'Chatbot flow not found'
      });
    }

    // Deactivate all other flows for this company
    await ChatbotFlow.updateMany(
      { 
        companyId: flow.companyId, 
        _id: { $ne: flow._id }
      },
      { isActive: false }
    );

    // Activate this flow
    flow.isActive = true;
    await flow.save();
    await FlowCacheService.invalidateCompanyCache(flow.companyId.toString());

    res.json({
      success: true,
      message: 'Flow activated successfully',
      data: flow
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to activate flow',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/chatbot-flows/:id/set-active-flow
 * @desc    Atomically: activate this flow, deactivate all others, and replace
 *          the company's WhatsApp config activeFlows with ONLY this flow.
 *          Replaces the 3-step (activate + assign + unassign) with 1 click.
 * @access  Private/SuperAdmin
 */
router.post('/:id/set-active-flow', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid chatbot flow ID format' });
    }

    const flow = await ChatbotFlow.findById(id);
    if (!flow) {
      return res.status(404).json({ success: false, message: 'Chatbot flow not found' });
    }

    // 1. Deactivate ALL other flows for this company
    await ChatbotFlow.updateMany(
      { companyId: flow.companyId, _id: { $ne: flow._id } },
      { isActive: false }
    );

    // 2. Activate THIS flow
    flow.isActive = true;
    await flow.save();

    // 3. Update WhatsApp config — replace activeFlows with ONLY this flow
    const waConfig = await CompanyWhatsAppConfig.findOne({ companyId: flow.companyId });
    if (waConfig) {
      waConfig.activeFlows = [{
        flowId: flow._id,
        flowType: flow.flowType || 'custom',
        isActive: true,
        priority: 0
      }] as any;
      await waConfig.save();
      await FlowCacheService.invalidateCompanyCache(flow.companyId.toString());
      logger.info(`✅ WhatsApp config activeFlows updated for company ${flow.companyId}`);
    } else {
      logger.warn(`⚠️ No WhatsApp config found for company ${flow.companyId} — skipping activeFlows update`);
    }

    logger.info(`✅ Flow set as active: ${flow.flowId || id}`);

    res.json({
      success: true,
      message: `"${flow.flowName}" is now the active flow`,
      data: { flow, waConfigUpdated: !!waConfig }
    });
  } catch (error: any) {
    logger.error('❌ Error setting active flow:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set active flow',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/chatbot-flows/company/:companyId/generate-defaults
 * @desc    Generate default flows for a company (grievance, appointment, tracking)
 * @access  Private/SuperAdmin
 */
router.post('/company/:companyId/generate-defaults', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const user = (req as any).user;

    console.log(`🔄 Generate default flows request for company: ${companyId}`);

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      logger.error(`❌ Invalid company ID format: ${companyId}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid company ID format'
      });
    }

    // Check if default flows already exist
    const exists = await hasDefaultFlows(companyId);
    if (exists) {
      logger.warn(`⚠️ Default flows already exist for company: ${companyId}`);
      // Instead of returning error, let's fetch and return the existing flows
      const existingFlows = await ChatbotFlow.find({
        companyId: new mongoose.Types.ObjectId(companyId),
        flowType: { $in: ['grievance', 'appointment', 'tracking'] }
      }).sort({ flowType: 1 });

      return res.status(200).json({
        success: true,
        message: `Default flows already exist. Found ${existingFlows.length} flow(s).`,
        data: existingFlows,
        alreadyExists: true
      });
    }

    // Generate default flows
    logger.info(`🚀 Generating default flows for company: ${companyId}`);
    await generateDefaultFlows(companyId, user._id);

    // Fetch created flows
    const createdFlows = await ChatbotFlow.find({
      companyId: new mongoose.Types.ObjectId(companyId),
      flowType: { $in: ['grievance', 'appointment', 'tracking'] }
    }).sort({ flowType: 1 });

    logger.info(`✅ Generated ${createdFlows.length} default flow(s) for company: ${companyId}`);

    res.json({
      success: true,
      message: `Generated ${createdFlows.length} default flow(s) successfully`,
      data: createdFlows,
      alreadyExists: false
    });
  } catch (error: any) {
    logger.error('❌ Error generating default flows:', error);
    logger.error('Error details:', {
      message: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    // If error is about existing flows, return 200 with existing flows
    if (error.message && error.message.includes('already exist')) {
      try {
        const existingFlows = await ChatbotFlow.find({
          companyId: new mongoose.Types.ObjectId(req.params.companyId),
          flowType: { $in: ['grievance', 'appointment', 'tracking'] }
        }).sort({ flowType: 1 });

        return res.status(200).json({
          success: true,
          message: error.message,
          data: existingFlows,
          alreadyExists: true
        });
      } catch (fetchError: any) {
        // Fall through to error response
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to generate default flows',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/chatbot-flows/company/:companyId/has-defaults
 * @desc    Check if default flows exist for a company
 * @access  Private/SuperAdmin
 */
router.get('/company/:companyId/has-defaults', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid company ID format'
      });
    }

    const exists = await hasDefaultFlows(companyId);

    res.json({
      success: true,
      hasDefaults: exists
    });
  } catch (error: any) {
    logger.error('❌ Error checking default flows:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check default flows',
      error: error.message
    });
  }
});

export default router;
