import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "@/contexts/AuthContext";
import { QueryProvider } from "@/lib/query/cache";
import HealthGuard from "@/components/HealthGuard";
import { Agentation } from "agentation";


export const metadata: Metadata = {
  title: {
    default: "PugArch Connect Dashboard",
    template: "%s | PugArch Connect",
  },
  description:
    "Multi-tenant grievance and appointment dashboard for company, department, and platform administrators.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <QueryProvider>
          <HealthGuard>
            <AuthProvider>
              {children}
              <Toaster
                position="top-right"
                toastOptions={{
                  duration: 1000,
                  success: {
                    duration: 1000,
                  },
                  error: {
                    duration: 5000,
                  },
                }}
              />
            </AuthProvider>
          </HealthGuard>
        </QueryProvider>
                {process.env.NODE_ENV === "development" && <Agentation />}

      </body>
    </html>
    
  );
}
