import { describe, it, expect } from "vitest";
import { computeBrandPolicyCrossCheck } from "./analysis";

// Regression coverage for the real case found this session: a naive "manufacturer != mandated
// brand -> flag as violation" check would have produced false positives on VMS/analytics software
// licenses the mandated camera brand legitimately doesn't make (confirmed against a real 21-item
// BOM: 2 Digifort licenses correctly diverged from a "Hikvision" policy with 0 real violations).
describe("computeBrandPolicyCrossCheck", () => {
  it("does not flag a single-item category (below the cross-check threshold) - keeps self-report, confidence low", () => {
    const items = [
      { category: "Servidor", manufacturer: "Dell", brand_policy_applicable: true, brand_policy_compliant: false },
    ];
    const result = computeBrandPolicyCrossCheck(items);
    expect(result[0].brand_policy_confidence).toBe("low");
  });

  it("raises confidence to high when a majority of a 3+ item category consistently diverges to the SAME alternate manufacturer", () => {
    const items = [
      { category: "Licença VMS", manufacturer: "Digifort", brand_policy_applicable: true, brand_policy_compliant: false },
      { category: "Licença VMS", manufacturer: "Digifort", brand_policy_applicable: true, brand_policy_compliant: false },
      { category: "Licença VMS", manufacturer: "Digifort", brand_policy_applicable: true, brand_policy_compliant: false },
    ];
    const result = computeBrandPolicyCrossCheck(items);
    for (const item of result) {
      expect(item.brand_policy_confidence).toBe("high");
    }
  });

  it("does not raise confidence when a 3+ item category diverges to DIFFERENT alternate manufacturers (no consistent signal)", () => {
    const items = [
      { category: "Câmera PTZ", manufacturer: "LILIN", brand_policy_applicable: true, brand_policy_compliant: false },
      { category: "Câmera PTZ", manufacturer: "Axis", brand_policy_applicable: true, brand_policy_compliant: false },
      { category: "Câmera PTZ", manufacturer: "Hikvision", brand_policy_applicable: true, brand_policy_compliant: true },
    ];
    const result = computeBrandPolicyCrossCheck(items);
    // No consistent alternate - stays at whatever the model already reported (medium fallback),
    // never silently upgraded to "high" without real same-BOM corroboration.
    for (const item of result) {
      expect(item.brand_policy_confidence).not.toBe("high");
    }
  });

  it("leaves items with brand_policy_applicable unset (null/undefined) completely untouched", () => {
    const items = [{ category: "Armário técnico", manufacturer: "Metel" }];
    const result = computeBrandPolicyCrossCheck(items);
    expect(result[0].brand_policy_confidence).toBeUndefined();
  });

  it("all-compliant category never gets flagged, regardless of group size", () => {
    const items = [
      { category: "Câmera PTZ", manufacturer: "Hikvision", brand_policy_applicable: true, brand_policy_compliant: true },
      { category: "Câmera PTZ", manufacturer: "Hikvision", brand_policy_applicable: true, brand_policy_compliant: true },
      { category: "Câmera PTZ", manufacturer: "Hikvision", brand_policy_applicable: true, brand_policy_compliant: true },
    ];
    const result = computeBrandPolicyCrossCheck(items);
    for (const item of result) {
      expect(item.brand_policy_confidence).not.toBe("high");
    }
  });
});
