'use client';

import { FlowNode, ListMessageNodeData, ButtonMessageNodeData, TextMessageNodeData, UserInputNodeData, MediaMessageNodeData } from '@/types/flowTypes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '../ui/textarea';
import { X, Trash2, Languages, Plus, Trash } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

interface NodeConfigPanelProps {
  node: FlowNode;
  onUpdate: (data: any) => void;
  onDelete: () => void;
  onClose: () => void;
  isMobile?: boolean;
}

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
  { code: 'or', name: 'Odia', flag: '🇮🇳' },
  { code: 'mr', name: 'Marathi', flag: '🇮🇳' },
];

export default function NodeConfigPanel({
  node,
  onUpdate,
  onDelete,
  onClose,
  isMobile = false,
}: NodeConfigPanelProps) {
  const [localData, setLocalData] = useState(node.data);

  // Update local data when node changes
  useEffect(() => {
    setLocalData(node.data);
  }, [node]);

  const handleChange = (field: string, value: any) => {
    const newData = { ...localData, [field]: value };
    setLocalData(newData);
    onUpdate(newData);
  };

  const handleTranslationChange = (field: string, lang: string, value: string) => {
    const translationsField = `${field}Translations`;
    const translations = { ...((localData as any)[translationsField] || {}) };
    translations[lang] = value;
    handleChange(translationsField, translations);
  };

  const renderTranslatableTextarea = (label: string, field: string, placeholder: string = "Enter text...") => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2">
          {label}
          <Languages className="w-3 h-3 text-blue-500" />
        </Label>
      </div>
      <Tabs defaultValue="en" className="w-full">
        <TabsList className="grid grid-cols-4 h-8">
          {LANGUAGES.map(lang => (
            <TabsTrigger key={lang.code} value={lang.code} className="text-[14px] px-0">
              {lang.code.toUpperCase()}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="en">
          <Textarea
            value={(localData as any)[field] || ''}
            onChange={(e) => handleChange(field, e.target.value)}
            placeholder={placeholder}
            rows={9}
            className="text-sm font-mono min-h-[180px]"
          />
        </TabsContent>
        {LANGUAGES.filter(l => l.code !== 'en').map(lang => (
          <TabsContent key={lang.code} value={lang.code}>
            <Textarea
              value={(localData as any)[`${field}Translations`]?.[lang.code] || ''}
              onChange={(e) => handleTranslationChange(field, lang.code, e.target.value)}
              placeholder={`Translation for ${lang.name}...`}
              rows={9}
              className="text-sm font-mono border-blue-200 focus:border-blue-400 min-h-[180px]"
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );

  const renderTranslatableInput = (label: string, field: string, placeholder: string = "Enter text...") => (
    <div className="space-y-2">
       <Label className="flex items-center gap-2">
          {label}
          <Languages className="w-3 h-3 text-blue-500" />
        </Label>
      <Tabs defaultValue="en" className="w-full">
        <TabsList className="grid grid-cols-4 h-8">
          {LANGUAGES.map(lang => (
            <TabsTrigger key={lang.code} value={lang.code} className="text-[14px] px-0">
              {lang.code.toUpperCase()}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="en">
          <Input
            value={(localData as any)[field] || ''}
            onChange={(e) => handleChange(field, e.target.value)}
            placeholder={placeholder}
            className="text-sm"
          />
        </TabsContent>
        {LANGUAGES.filter(l => l.code !== 'en').map(lang => (
          <TabsContent key={lang.code} value={lang.code}>
            <Input
              value={(localData as any)[`${field}Translations`]?.[lang.code] || ''}
              onChange={(e) => handleTranslationChange(field, lang.code, e.target.value)}
              placeholder={`Translation in ${lang.name}...`}
              className="text-sm border-blue-200"
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );

  const renderConfigFields = () => {
    switch (node.type) {
      case 'textMessage':
        return (
          <div className="space-y-6">
            <div>
              <Label htmlFor="label">Node ID (Internal)</Label>
              <Input
                id="label"
                value={localData.label || ''}
                onChange={(e) => handleChange('label', e.target.value)}
              />
            </div>
            {renderTranslatableTextarea("Message Content", "messageText")}
          </div>
        );

      case 'buttonMessage':
        const btnData = localData as ButtonMessageNodeData;
        return (
          <div className="space-y-6">
            <div>
              <Label htmlFor="label">Node ID</Label>
              <Input id="label" value={localData.label || ''} onChange={(e) => handleChange('label', e.target.value)} />
            </div>
            {renderTranslatableTextarea("Message Content", "messageText")}
            <div className="space-y-4">
              <Label>Buttons (Max 3)</Label>
              {(btnData.buttons || []).map((btn: any, index: number) => (
                <div key={index} className="p-3 border rounded-lg bg-white space-y-3 relative shadow-sm">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="absolute top-1 right-1 h-6 w-6 text-red-500"
                    onClick={() => {
                      const newBtns = btnData.buttons.filter((_, i) => i !== index);
                      handleChange('buttons', newBtns);
                    }}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                  
                  <div className="space-y-1">
                    <Label className="text-[14px] uppercase text-gray-400">Main Title (English)</Label>
                    <Input
                      value={btn.text}
                      onChange={(e) => {
                        const newBtns = [...btnData.buttons];
                        newBtns[index] = { ...btn, text: e.target.value };
                        handleChange('buttons', newBtns);
                      }}
                      placeholder="Button text"
                      maxLength={20}
                      className="h-8 text-xs"
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 gap-1">
                    <Label className="text-[14px] uppercase text-blue-400">Translations</Label>
                    {LANGUAGES.filter(l => l.code !== 'en').map(lang => (
                      <div key={lang.code} className="flex items-center gap-2">
                        <span className="text-[14px] w-6 uppercase text-gray-500">{lang.code}</span>
                        <Input
                          value={btn.titleTranslations?.[lang.code] || ''}
                          onChange={(e) => {
                            const newBtns = [...btnData.buttons];
                            const translations = { ...(btn.titleTranslations || {}) };
                            translations[lang.code] = e.target.value;
                            newBtns[index] = { ...btn, titleTranslations: translations };
                            handleChange('buttons', newBtns);
                          }}
                          placeholder={`...`}
                          className="h-7 text-[14px] border-blue-50"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {(btnData.buttons || []).length < 3 && (
                <Button variant="outline" size="sm" className="w-full border-dashed" 
                  onClick={() => handleChange('buttons', [...(btnData.buttons || []), { id: `btn_${Date.now()}`, text: 'New Button', type: 'quick_reply' }])}>
                  <Plus className="w-3 h-3 mr-2" /> Add Button
                </Button>
              )}
            </div>
          </div>
        );

      case 'listMessage':
        const listData = localData as ListMessageNodeData;
        return (
          <div className="space-y-6">
            <div>
              <Label htmlFor="label">Node ID</Label>
              <Input id="label" value={localData.label || ''} onChange={(e) => handleChange('label', e.target.value)} />
            </div>
            {renderTranslatableTextarea("Message Content", "messageText")}
            {renderTranslatableInput("Button Text", "buttonText", "e.g., View Departments")}
            
            <div className="space-y-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
              <div className="flex items-center justify-between">
                <Label className="text-blue-700 font-bold">Dynamic List</Label>
                <input
                  type="checkbox"
                  checked={listData.isDynamic || false}
                  onChange={(e) => handleChange('isDynamic', e.target.checked)}
                />
              </div>
              {listData.isDynamic && (
                <select
                  value={listData.dynamicSource || 'departments'}
                  onChange={(e) => handleChange('dynamicSource', e.target.value)}
                  className="w-full text-xs border rounded p-1"
                >
                  <option value="departments">Departments</option>
                  <option value="custom">Custom API</option>
                </select>
              )}
            </div>

            {!listData.isDynamic && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Sections</Label>
                  <Button variant="outline" size="sm" className="h-7 text-[14px]" 
                    onClick={() => handleChange('sections', [...(listData.sections || []), { title: 'New Section', rows: [] }])}>
                    + Add Section
                  </Button>
                </div>
                {(listData.sections || []).map((section, sIdx) => (
                   <div key={sIdx} className="p-2 border rounded-md bg-gray-50 space-y-2">
                     <div className="flex justify-between items-center">
                       <Input 
                         value={section.title} 
                         onChange={(e) => {
                           const newSections = [...listData.sections];
                           newSections[sIdx] = { ...section, title: e.target.value };
                           handleChange('sections', newSections);
                         }}
                         placeholder="Section Title"
                         className="h-7 text-xs font-bold"
                       />
                       <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                          const newSections = listData.sections.filter((_, i) => i !== sIdx);
                          handleChange('sections', newSections);
                       }}>
                         <Trash className="w-3 h-3" />
                       </Button>
                     </div>
                     
                     <div className="space-y-2 pl-2 border-l-2 border-gray-200">
                        {(section.rows || []).map((row, rIdx) => (
                           <div key={rIdx} className="p-2 bg-white rounded border shadow-sm space-y-2 relative">
                              <Button variant="ghost" size="icon" className="absolute top-0 right-0 h-5 w-5" onClick={() => {
                                const newSections = [...listData.sections];
                                newSections[sIdx].rows = section.rows.filter((_, i) => i !== rIdx);
                                handleChange('sections', newSections);
                              }}>
                                <X className="w-2 h-2" />
                              </Button>
                              <Input 
                                value={row.title} 
                                onChange={(e) => {
                                  const newSections = [...listData.sections];
                                  newSections[sIdx].rows[rIdx] = { ...row, title: e.target.value };
                                  handleChange('sections', newSections);
                                }}
                                placeholder="Row Title"
                                className="h-7 text-[15px]"
                              />
                              <div className="pl-2 space-y-1">
                                {LANGUAGES.filter(l => l.code !== 'en').map(lang => (
                                  <Input 
                                    key={lang.code}
                                    value={row.titleTranslations?.[lang.code] || ''}
                                    onChange={(e) => {
                                      const newSections = [...listData.sections];
                                      const trans = { ...(row.titleTranslations || {}) };
                                      trans[lang.code] = e.target.value;
                                      newSections[sIdx].rows[rIdx] = { ...row, titleTranslations: trans };
                                      handleChange('sections', newSections);
                                    }}
                                    placeholder={`${lang.code.toUpperCase()} title...`}
                                    className="h-6 text-[14px] border-blue-50"
                                  />
                                ))}
                              </div>
                           </div>
                        ))}
                        <Button variant="ghost" size="sm" className="w-full h-6 text-[15px] border border-dashed" onClick={() => {
                           const newSections = [...listData.sections];
                           newSections[sIdx].rows = [...(section.rows || []), { id: `row_${Date.now()}`, title: 'New Option' }];
                           handleChange('sections', newSections);
                        }}>+ Add Row</Button>
                     </div>
                   </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'userInput':
        return (
          <div className="space-y-6">
            <div>
              <Label>Variable Name (saveToField)</Label>
              <Input
                value={(localData as UserInputNodeData).saveToField || ''}
                onChange={(e) => handleChange('saveToField', e.target.value)}
                placeholder="e.g., citizenName"
              />
            </div>
            {renderTranslatableTextarea("Prompt Message", "messageText")}
            <div>
              <Label>Input Type</Label>
              <select
                value={(localData as UserInputNodeData).inputType || 'text'}
                onChange={(e) => handleChange('inputType', e.target.value)}
                className="w-full text-sm border rounded p-2"
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="phone">Phone</option>
                <option value="email">Email</option>
                <option value="image">Photo/Media</option>
              </select>
            </div>
          </div>
        );

      case 'mediaMessage':
        return (
          <div className="space-y-6">
            <div>
              <Label>Media Type</Label>
              <select
                 value={(localData as MediaMessageNodeData).mediaType || 'image'}
                 onChange={(e) => handleChange('mediaType', e.target.value)}
                 className="w-full text-sm border rounded p-2"
              >
                <option value="image">Image</option>
                <option value="video">Video</option>
                <option value="document">Document</option>
              </select>
            </div>
            <div>
              <Label>Media URL</Label>
              <Input
                value={(localData as MediaMessageNodeData).mediaUrl || ''}
                onChange={(e) => handleChange('mediaUrl', e.target.value)}
                placeholder="https://..."
              />
            </div>
            {renderTranslatableInput("Caption", "caption")}
          </div>
        );

      case 'assignDepartment':
        return (
          <div className="space-y-4">
             <div>
                <Label>Department ID</Label>
                <Input value={(localData as any).departmentId || ''} onChange={(e) => handleChange('departmentId', e.target.value)} />
             </div>
             <div className="flex items-center gap-2">
                <input type="checkbox" checked={(localData as any).isDynamic} onChange={(e) => handleChange('isDynamic', e.target.checked)} />
                <Label>Dynamic from variable</Label>
             </div>
          </div>
        );

      case 'condition':
        return (
          <div className="space-y-4">
            <div><Label>Variable to Check</Label><Input value={(localData as any).field || ''} onChange={(e) => handleChange('field', e.target.value)} /></div>
            <div><Label>Operator</Label>
              <select value={(localData as any).operator || 'equals'} onChange={(e) => handleChange('operator', e.target.value)} className="w-full border rounded p-2 text-sm">
                <option value="equals">Equals</option>
                <option value="contains">Contains</option>
                <option value="exists">Has Value</option>
              </select>
            </div>
            <div><Label>Value</Label><Input value={(localData as any).value || ''} onChange={(e) => handleChange('value', e.target.value)} /></div>
          </div>
        );

      case 'end':
        return (
          <div className="space-y-6">
            {renderTranslatableTextarea("End Message", "endMessage")}
            <div className="flex items-center gap-2">
               <input type="checkbox" checked={(localData as any).clearSession} onChange={(e) => handleChange('clearSession', e.target.checked)} />
               <Label>Clear Session on Finish</Label>
            </div>
          </div>
        );

      default:
        return (
          <div className="p-4 bg-gray-50 rounded border italic text-gray-500 text-sm">
            Simple configuration for {node.type}
          </div>
        );
    }
  };

  return (
    <div className={`${isMobile ? "w-full h-[88vh] bottom-0 top-auto rounded-t-2xl border-t border-l-0 animate-in slide-in-from-bottom" : "w-96 h-screen top-0 right-0 border-l animate-in slide-in-from-right"} bg-white border-gray-200 flex flex-col fixed shadow-2xl z-50 duration-300`}>
      {/* Header */}
      <div className="relative p-4 border-b border-gray-100 flex items-center justify-between bg-white flex-shrink-0">
        {isMobile && <div className="absolute left-1/2 top-1 -translate-x-1/2 h-1 w-12 rounded-full bg-slate-200" />}
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500"></span>
            <h3 className="font-bold text-gray-900">Node Settings</h3>
          </div>
          <p className="text-[14px] uppercase tracking-wider text-gray-400 mt-0.5">{node.type}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0 rounded-full hover:bg-gray-100">
          <X className="w-4 h-4 text-gray-500" />
        </Button>
      </div>

      {/* Configuration Fields */}
      <div className="flex-1 overflow-y-auto p-5 pb-10 custom-scrollbar">
        {renderConfigFields()}
      </div>

      {/* Footer Actions */}
      <div className="p-4 border-t border-gray-100 bg-gray-50/80 backdrop-blur-sm flex gap-2">
        <Button
          variant="outline"
          className="flex-1 gap-2 text-xs font-semibold h-10 border-red-100 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-all"
          onClick={onDelete}
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </Button>
      </div>
      
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f1f1;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #ddd;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #ccc;
        }
      `}</style>
    </div>
  );
}
