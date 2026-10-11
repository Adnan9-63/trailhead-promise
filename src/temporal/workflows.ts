import {
  defineSignal,
  defineQuery,
  setHandler,
  sleep,
  proxyActivities,
  condition,
} from "@temporalio/workflow";
import type * as activities from "./activities.js";
import { HikePlan, WorkflowState } from "../types.js";

// Activity proxy with resilient retry policy
const { sendCheckinReminder, dispatchEmergencyEscalation, recordTelemetry } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: "30 seconds",
    retry: {
      initialInterval: "2 seconds",
      maximumInterval: "30 seconds",
      backoffCoefficient: 2,
      maximumAttempts: 4,
    },
  });

// Define Signals
export const checkInSignal = defineSignal("checkIn");
export const extendTimerSignal = defineSignal<[number]>("extendTimer");
export const lowBatterySignal = defineSignal<[{ latitude: number; longitude: number; batteryPercent: number }]>("lowBattery");
export const updateCoordinatesSignal = defineSignal<[{ latitude: number; longitude: number }]>("updateCoordinates");

// Define Queries
export const getStateQuery = defineQuery<WorkflowState>("getState");

export async function trailheadSafetyWorkflow(planId: string, plan: HikePlan): Promise<WorkflowState> {
  const startTime = Date.now();
  // Duration in milliseconds (for demo/simulation, we can scale or use explicit hours/minutes)
  let durationMs = plan.estimatedDurationHours * 60 * 60 * 1000;
  let deadline = startTime + durationMs;
  let isCheckedIn = false;
  let isCriticalBattery = false;

  const state: WorkflowState = {
    planId,
    status: "ACTIVE",
    remainingMinutes: Math.round(durationMs / 60000),
    batteryPercent: plan.initialBatteryPercent,
    lastKnownCoordinates: plan.lastKnownCoordinates
      ? {
          latitude: plan.lastKnownCoordinates.latitude,
          longitude: plan.lastKnownCoordinates.longitude,
          timestamp: new Date().toISOString(),
        }
      : undefined,
    eventLog: [
      {
        timestamp: new Date().toISOString(),
        type: "PLAN_COMMITTED",
        message: `Hike plan registered for "${plan.trailName}" to "${plan.destination}". Deadline: ${plan.deadlineTime}`,
      },
    ],
  };

  // Signal Handlers
  setHandler(checkInSignal, () => {
    isCheckedIn = true;
    state.status = "COMPLETED_SAFE";
    state.lastCheckinTime = new Date().toISOString();
    state.eventLog.push({
      timestamp: state.lastCheckinTime,
      type: "CHECKIN_RECEIVED",
      message: "Hiker safely checked in! Workflow marked as complete.",
    });
  });

  setHandler(extendTimerSignal, (additionalMinutes: number) => {
    durationMs += additionalMinutes * 60 * 1000;
    deadline += additionalMinutes * 60 * 1000;
    state.status = "TIMER_EXTENDED";
    state.eventLog.push({
      timestamp: new Date().toISOString(),
      type: "TIMER_EXTENDED",
      message: `Hiker requested extension of ${additionalMinutes} minutes. New deadline updated.`,
    });
  });

  setHandler(lowBatterySignal, (payload) => {
    state.batteryPercent = payload.batteryPercent;
    state.lastKnownCoordinates = {
      latitude: payload.latitude,
      longitude: payload.longitude,
      timestamp: new Date().toISOString(),
    };
    if (payload.batteryPercent <= 5) {
      isCriticalBattery = true;
      state.status = "LOW_BATTERY_WARNING";
      state.eventLog.push({
        timestamp: new Date().toISOString(),
        type: "CRITICAL_LOW_BATTERY",
        message: `CRITICAL: Phone battery at ${payload.batteryPercent}%. Last GPS lock: ${payload.latitude}, ${payload.longitude}`,
      });
    }
  });

  setHandler(updateCoordinatesSignal, (coords) => {
    state.lastKnownCoordinates = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      timestamp: new Date().toISOString(),
    };
    state.eventLog.push({
      timestamp: new Date().toISOString(),
      type: "GPS_BREADCRUMB",
      message: `Updated location: ${coords.latitude}, ${coords.longitude}`,
    });
  });

  // Query Handler
  setHandler(getStateQuery, () => {
    const remaining = Math.max(0, Math.round((deadline - Date.now()) / 60000));
    state.remainingMinutes = remaining;
    return state;
  });

  await recordTelemetry(planId, "WORKFLOW_INITIALIZED", { trail: plan.trailName, deadline: plan.deadlineTime });

  // Main Durable Wait Loop
  // Wait until either checked in, or the deadline is reached
  const checkinSuccess = await condition(() => isCheckedIn, deadline - Date.now());

  if (checkinSuccess) {
    await recordTelemetry(planId, "HIKE_COMPLETED_SAFELY");
    return state;
  }

  // If deadline reached without check-in, issue reminder activity
  await sendCheckinReminder(plan);
  state.eventLog.push({
    timestamp: new Date().toISOString(),
    type: "REMINDER_DISPATCHED",
    message: "Primary deadline reached without check-in. Entering emergency grace period.",
  });

  // Wait for Grace Period (e.g. 30 minutes, or scaled for test)
  const graceMs = plan.emergencyGracePeriodMinutes * 60 * 1000;
  const graceCheckedIn = await condition(() => isCheckedIn, graceMs);

  if (graceCheckedIn) {
    await recordTelemetry(planId, "HIKE_COMPLETED_DURING_GRACE");
    return state;
  }

  // EMERGENCY TRIGGER: Escalation
  state.status = "ESCALATED_ALERT";
  const reason = isCriticalBattery ? "CRITICAL_LOW_BATTERY" : "DEADLINE_MISSED";
  
  state.eventLog.push({
    timestamp: new Date().toISOString(),
    type: "ESCALATION_TRIGGERED",
    message: `EMERGENCY: Grace period expired. Escalation reason: ${reason}. Alerting emergency contacts.`,
  });

  await dispatchEmergencyEscalation({
    planId,
    plan,
    escalationReason: reason,
    lastKnownCoordinates: state.lastKnownCoordinates,
    eventHistory: state.eventLog,
  });

  await recordTelemetry(planId, "ESCALATION_EXECUTED", { reason });

  return state;
}
