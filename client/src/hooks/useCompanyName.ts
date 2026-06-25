import { useState, useEffect } from "react";

export function useCompanyName(): string {
  const [companyName, setCompanyName] = useState("Your Company Name");

  useEffect(() => {
    fetch("/api/public/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data?.companyName) setCompanyName(data.companyName);
      })
      .catch(() => {});
  }, []);

  return companyName;
}
