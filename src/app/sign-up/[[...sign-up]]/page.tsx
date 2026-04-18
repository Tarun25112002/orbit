import { SignUp } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function SignUpPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background">
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
      </div>
      
      <div className="relative z-10 w-full max-w-md p-6">
        <Link 
          href="/" 
          className="group flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
          Back to home
        </Link>
        
        <SignUp 
          appearance={{
            baseTheme: dark,
            elements: {
              card: "bg-card border border-border shadow-2xl rounded-2xl",
              headerTitle: "text-foreground",
              headerSubtitle: "text-muted-foreground",
              socialButtonsBlockButton: "border-border hover:bg-muted text-foreground",
              formButtonPrimary: "bg-foreground text-background hover:bg-foreground/90 transition-colors",
              formFieldInput: "bg-background border-border text-foreground",
              formFieldLabel: "text-foreground",
              footerActionLink: "text-foreground hover:opacity-80 transition-opacity",
              identityPreviewText: "text-foreground",
              identityPreviewEditButton: "text-muted-foreground hover:text-foreground",
            }
          }}
        />
      </div>
    </div>
  );
}
