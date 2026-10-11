import { EscalationPayload, HikePlan } from "../types.js";
import * as Sentry from "@sentry/node";

// Initialize Sentry for Agent & Workflow Observability (Hacktoberfest Sentry Category)
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0,
  });
}

export async function sendCheckinReminder(plan: HikePlan): Promise<{ status: string; sentAt: string }> {
  const timestamp = new Date().toISOString();
  console.log(`[ACTIVITY: REMINDER] 🔔 Sending check-in reminder to hiker for trail "${plan.trailName}". Deadline approaching at ${plan.deadlineTime}.`);
  
  Sentry.captureMessage(`Hiker reminder triggered for ${plan.trailName}`, "info");

  return {
    status: "SENT",
    sentAt: timestamp,
  };
}

export async function dispatchEmergencyEscalation(payload: EscalationPayload): Promise<{ dispatched: boolean; contactCount: number; alertId: string }> {
  const alertId = `SOS-${Date.now().toString(36).toUpperCase()}`;
  console.warn(`\n================================================================================`);
  console.warn(`🚨 [ACTIVITY: EMERGENCY ESCALATION DISPATCHED] 🚨`);
  console.warn(`Alert ID: ${alertId}`);
  console.warn(`Reason: ${payload.escalationReason}`);
  console.warn(`Trail: ${payload.plan.trailName} (Destination: ${payload.plan.destination})`);
  console.warn(`Last Known GPS: ${payload.lastKnownCoordinates ? `${payload.lastKnownCoordinates.latitude}, ${payload.lastKnownCoordinates.longitude}` : "Unknown"}`);
  console.warn(`Contingency Notes: ${payload.plan.contingencyNotes || "None specified"}`);
  console.warn(`Emergency Contacts Notified:`);
  
  payload.plan.emergencyContacts.forEach((contact, idx) => {
    console.warn(`  ${idx + 1}. ${contact.name} (${contact.phone}) [${contact.relationship || "contact"}]`);
  });
  console.warn(`================================================================================\n`);

  Sentry.captureException(new Error(`Emergency Escalation triggered for ${payload.plan.trailName}: ${payload.escalationReason}`));

  return {
    dispatched: true,
    contactCount: payload.plan.emergencyContacts.length,
    alertId,
  };
}

export async function recordTelemetry(planId: string, event: string, metadata?: Record<string, any>): Promise<void> {
  console.log(`[ACTIVITY: TELEMETRY] Plan: ${planId} | Event: ${event} | Meta:`, metadata || {});
}
