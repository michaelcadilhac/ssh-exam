import { monitoringShow } from "./monitoring-management.js";

export const monitoringExportPurpose = "ssh-exam-monitoring-export/v1";
export const monitoringExportContentType =
  "application/vnd.ssh-exam-monitoring-export+ndjson";
export const monitoringExportChunk = 256 * 1024;
export const monitoringExportPayload = 4 * 1024 * 1024;
export const monitoringExportRequest = monitoringShow;

export const monitoringExportSections = [
  "frames",
  "terminals",
  "incidents",
  "interruptions",
] as const;
export type MonitoringExportSection = (typeof monitoringExportSections)[number];
export type MonitoringExportInventory = Record<
  MonitoringExportSection,
  { through: number; count: number }
>;
