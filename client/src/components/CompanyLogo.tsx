import { Phone } from "lucide-react";

interface CompanyLogoProps {
  logoUrl?: string | null;
  size?: number;
}

export function CompanyLogo({ logoUrl, size = 32 }: CompanyLogoProps) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt="Company logo"
        className="rounded-md object-contain bg-white"
        style={{ width: size, height: size }}
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
