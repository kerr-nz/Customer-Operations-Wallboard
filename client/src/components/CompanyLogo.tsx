import { Phone } from "lucide-react";
import { useState, useEffect } from "react";

interface CompanyLogoProps {
  logoUrl?: string | null;
  size?: number;
}

export function CompanyLogo({ logoUrl, size = 32 }: CompanyLogoProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [logoUrl]);

  const isValidLogo = !!logoUrl && logoUrl.startsWith("data:image/");

  if (isValidLogo && !failed) {
    return (
      <img
        src={logoUrl as string}
        alt="Company logo"
        className="rounded-md object-contain bg-white"
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
        data-testid="img-company-logo"
      />
    );
  }
  return (
    <div
      className="rounded-md bg-primary flex items-center justify-center"
      style={{ width: size, height: size }}
      data-testid="div-company-logo-fallback"
    >
      <Phone className="text-primary-foreground" style={{ width: size * 0.5, height: size * 0.5 }} />
    </div>
  );
}
