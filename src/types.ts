import { z } from "zod";

// Zod Schema for strict AI Plan Extraction (Gemma + Mastra compatibility)
export const ContactSchema = z.object({
  name: z.string().describe("Name of the emergency contact"),
  phone: z.string().describe("Phone number or SMS contact"),
  relationship: z.string().optional().describe("e.g. brother, partner, friend"),
});

export const HikePlanSchema = z.object({
  trailName: z.string().describe("Name of the trail, mountain, or route"),
  startLocation: z.string().describe("Starting trailhead or point"),
  destination: z.string().describe("Summit, turnaround point, or destination"),
  estimatedDurationHours: z.number().positive().describe("Expected duration in hours"),
  deadlineTime: z.string().describe("ISO timestamp or HH:MM format for expected return"),
  emergencyGracePeriodMinutes: z.number().int().default(30).describe("Grace period before escalation triggers"),
  emergencyContacts: z.array(ContactSchema).min(1).describe("At least one emergency contact"),
  contingencyNotes: z.string().optional().describe("Known hazard areas or planned detour notes"),
  initialBatteryPercent: z.number().min(0).max(100).default(100),
  lastKnownCoordinates: z.object({
    latitude: z.number(),
    longitude: z.number(),
    altitudeMeters: z.number().optional(),
    timestamp: z.string().optional(),
  }).optional(),
});

export type Contact = z.infer<typeof ContactSchema>;
export type HikePlan = z.infer<typeof HikePlanSchema>;

export interface WorkflowState {
  planId: string;
  status: "ACTIVE" | "COMPLETED_SAFE" | "ESCALATED_ALERT" | "TIMER_EXTENDED" | "LOW_BATTERY_WARNING";
  lastCheckinTime?: string;
  remainingMinutes: number;
  batteryPercent: number;
  lastKnownCoordinates?: {
    latitude: number;
    longitude: number;
    timestamp: string;
  };
  eventLog: Array<{
    timestamp: string;
    type: string;
    message: string;
  }>;
}

export interface EscalationPayload {
  planId: string;
  plan: HikePlan;
  escalationReason: "DEADLINE_MISSED" | "CRITICAL_LOW_BATTERY" | "MANUAL_SOS";
  lastKnownCoordinates?: {
    latitude: number;
    longitude: number;
    timestamp: string;
  };
  eventHistory: WorkflowState["eventLog"];
}
