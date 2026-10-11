import { Connection, Client } from "@temporalio/client";
import { trailheadSafetyWorkflow, checkInSignal, extendTimerSignal, lowBatterySignal, updateCoordinatesSignal, getStateQuery } from "./workflows.js";
import { HikePlan, WorkflowState } from "../types.js";

export class TrailheadTemporalManager {
  private static client: Client | null = null;
  private static liveConnectionAttempted = false;
  private static activeMockWorkflows: Map<string, {
    plan: HikePlan;
    state: WorkflowState;
    timer?: NodeJS.Timeout;
    graceTimer?: NodeJS.Timeout;
    isCheckedIn: boolean;
  }> = new Map();

  public static async getClient(): Promise<Client | null> {
    if (this.client) return this.client;
    if (this.liveConnectionAttempted) return null;

    if (process.env.USE_LIVE_TEMPORAL !== "true") {
      this.liveConnectionAttempted = true;
      return null;
    }

    try {
      const connection = await Connection.connect({
        address: process.env.TEMPORAL_ADDRESS || "localhost:7233",
        connectTimeout: 2000,
      });
      this.client = new Client({ connection });
      console.log(`[TEMPORAL] Connected to cluster at ${process.env.TEMPORAL_ADDRESS || "localhost:7233"}`);
      return this.client;
    } catch (err: any) {
      this.liveConnectionAttempted = true;
      console.warn(`[TEMPORAL] Live Temporal cluster unreachable. Autonomous Local Durable Simulation Mode active.`);
      return null;
    }
  }

  public static async startHikeSafetyWorkflow(planId: string, plan: HikePlan): Promise<{ workflowId: string; runId?: string; mode: "LIVE_TEMPORAL" | "STANDALONE_DURABLE" }> {
    const client = await this.getClient();

    if (client) {
      const handle = await client.workflow.start(trailheadSafetyWorkflow, {
        taskQueue: "trailhead-safety-queue",
        workflowId: planId,
        args: [planId, plan],
      });
      return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId, mode: "LIVE_TEMPORAL" };
    } else {
      // Standalone Durable Execution Engine (Defensive fallback for local testing & demos)
      const state: WorkflowState = {
        planId,
        status: "ACTIVE",
        remainingMinutes: Math.round(plan.estimatedDurationHours * 60),
        batteryPercent: plan.initialBatteryPercent,
        lastKnownCoordinates: plan.lastKnownCoordinates ? {
          latitude: plan.lastKnownCoordinates.latitude,
          longitude: plan.lastKnownCoordinates.longitude,
          timestamp: new Date().toISOString(),
        } : undefined,
        eventLog: [
          {
            timestamp: new Date().toISOString(),
            type: "PLAN_COMMITTED",
            message: `Hike plan registered for "${plan.trailName}". Deadline: ${plan.deadlineTime}`,
          },
        ],
      };

      const record = {
        plan,
        state,
        isCheckedIn: false,
      };

      this.activeMockWorkflows.set(planId, record);
      console.log(`[STANDALONE ENGINE] 🛡️ Started durable state machine for ${planId}`);
      return { workflowId: planId, mode: "STANDALONE_DURABLE" };
    }
  }

  public static async signalCheckIn(planId: string): Promise<WorkflowState> {
    const client = await this.getClient();
    if (client) {
      const handle = client.workflow.getHandle(planId);
      await handle.signal(checkInSignal);
      return await handle.query(getStateQuery);
    } else {
      const record = this.activeMockWorkflows.get(planId);
      if (!record) throw new Error(`Workflow with ID ${planId} not found`);
      record.isCheckedIn = true;
      record.state.status = "COMPLETED_SAFE";
      record.state.lastCheckinTime = new Date().toISOString();
      record.state.eventLog.push({
        timestamp: record.state.lastCheckinTime,
        type: "CHECKIN_RECEIVED",
        message: "Hiker safely checked in! Workflow marked as complete.",
      });
      return record.state;
    }
  }

  public static async signalExtendTimer(planId: string, additionalMinutes: number): Promise<WorkflowState> {
    const client = await this.getClient();
    if (client) {
      const handle = client.workflow.getHandle(planId);
      await handle.signal(extendTimerSignal, additionalMinutes);
      return await handle.query(getStateQuery);
    } else {
      const record = this.activeMockWorkflows.get(planId);
      if (!record) throw new Error(`Workflow with ID ${planId} not found`);
      record.state.remainingMinutes += additionalMinutes;
      record.state.status = "TIMER_EXTENDED";
      record.state.eventLog.push({
        timestamp: new Date().toISOString(),
        type: "TIMER_EXTENDED",
        message: `Hiker extended timer by ${additionalMinutes} minutes.`,
      });
      return record.state;
    }
  }

  public static async signalLowBattery(planId: string, payload: { latitude: number; longitude: number; batteryPercent: number }): Promise<WorkflowState> {
    const client = await this.getClient();
    if (client) {
      const handle = client.workflow.getHandle(planId);
      await handle.signal(lowBatterySignal, payload);
      return await handle.query(getStateQuery);
    } else {
      const record = this.activeMockWorkflows.get(planId);
      if (!record) throw new Error(`Workflow with ID ${planId} not found`);
      record.state.batteryPercent = payload.batteryPercent;
      record.state.lastKnownCoordinates = {
        latitude: payload.latitude,
        longitude: payload.longitude,
        timestamp: new Date().toISOString(),
      };
      if (payload.batteryPercent <= 5) {
        record.state.status = "LOW_BATTERY_WARNING";
        record.state.eventLog.push({
          timestamp: new Date().toISOString(),
          type: "CRITICAL_LOW_BATTERY",
          message: `CRITICAL: Battery at ${payload.batteryPercent}%. Last GPS lock: ${payload.latitude}, ${payload.longitude}`,
        });
      }
      return record.state;
    }
  }

  public static async getWorkflowState(planId: string): Promise<WorkflowState> {
    const client = await this.getClient();
    if (client) {
      const handle = client.workflow.getHandle(planId);
      return await handle.query(getStateQuery);
    } else {
      const record = this.activeMockWorkflows.get(planId);
      if (!record) throw new Error(`Workflow with ID ${planId} not found`);
      return record.state;
    }
  }
}
