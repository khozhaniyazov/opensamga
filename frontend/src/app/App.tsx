import { RouterProvider } from "react-router";
import { router } from "./routes";
import { PlanProvider } from "./components/billing/PlanContext";
import { LanguageProvider } from "./components/LanguageContext";
import { AuthProvider } from "./components/auth/AuthContext";
import { Toaster } from "./components/ui/sonner";

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <PlanProvider>
          <RouterProvider router={router} />
          {/* F-17: global toast portal so checkout / profile / etc.
           * can fire transient confirmation messages without each
           * surface inventing its own banner. */}
          <Toaster position="top-center" richColors closeButton />
        </PlanProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
