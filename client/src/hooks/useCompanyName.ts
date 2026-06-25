import { useState, useEffect } from "react";

interface CompanyBranding {
  companyName: string;
  logoUrl: string | null;
}

export function useCompanyName(): CompanyBranding {
  const [branding, setBranding] = useState<CompanyBranding>({
    companyName: "Your Company Name",
    logoUrl: null,
  });

  useEffect(() => {
    fetch("/api/public/settings")
      .then((res) => res.json())
      .then((data) => {
        setBranding({
          companyName: data?.companyName || "Your Company Name",
          logoUrl: data?.logoUrl || null,
        });
      })
      .catch(() => {});
  }, []);

  return branding;
}
