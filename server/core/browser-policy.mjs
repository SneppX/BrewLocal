import { RiskLevel } from "./permissions.mjs";

export const BROWSER_OPERATION_POLICY = Object.freeze({
  browser_inspect: Object.freeze({ operation: "inspect", risk: RiskLevel.READ }),
  browser_click: Object.freeze({ operation: "click", risk: RiskLevel.EXTERNAL }),
  browser_type: Object.freeze({ operation: "type", risk: RiskLevel.EXTERNAL }),
  browser_fill: Object.freeze({ operation: "fill", risk: RiskLevel.EXTERNAL }),
  browser_scroll: Object.freeze({ operation: "scroll", risk: RiskLevel.READ }),
  browser_screenshot: Object.freeze({ operation: "screenshot", risk: RiskLevel.READ }),
  browser_extract: Object.freeze({ operation: "extract", risk: RiskLevel.READ }),
  browser_tabs: Object.freeze({ operation: "tabs", risk: RiskLevel.READ }),
  browser_wait: Object.freeze({ operation: "wait", risk: RiskLevel.READ }),
});
