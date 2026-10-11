import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { TrailIntentParser } from "./parser/intentParser.js";
import { TrailheadTemporalManager } from "./temporal/client.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// 1. Ingest Voice/Text Transcript -> Gemma Schema Extraction
app.post("/api/plan/parse", async (req, res) => {
  try {
    const { transcript, coordinates } = req.body;
    if (!transcript) {
      return res.status(400).json({ error: "Voice transcript or text is required." });
    }

    const plan = await TrailIntentParser.parseTranscript(transcript, coordinates);
    res.json({ success: true, plan });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Start Temporal Durable Workflow
app.post("/api/workflow/start", async (req, res) => {
  try {
    const { plan } = req.body;
    if (!plan || !plan.trailName) {
      return res.status(400).json({ error: "Valid HikePlan object required." });
    }

    const planId = `HIKE-${Date.now().toString(36).toUpperCase()}`;
    const result = await TrailheadTemporalManager.startHikeSafetyWorkflow(planId, plan);

    res.json({
      success: true,
      planId,
      executionMode: result.mode,
      message: `Durable safety promise established for ${plan.trailName}.`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Signal: Safe Check-in
app.post("/api/workflow/:id/checkin", async (req, res) => {
  try {
    const { id } = req.params;
    const state = await TrailheadTemporalManager.signalCheckIn(id);
    res.json({ success: true, message: "Hiker checked in safely!", state });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Signal: Extend Timer
app.post("/api/workflow/:id/extend", async (req, res) => {
  try {
    const { id } = req.params;
    const { minutes } = req.body;
    const state = await TrailheadTemporalManager.signalExtendTimer(id, Number(minutes) || 60);
    res.json({ success: true, message: `Timer extended by ${minutes} minutes.`, state });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Signal: Low Battery Dead-Man's Switch
app.post("/api/workflow/:id/battery", async (req, res) => {
  try {
    const { id } = req.params;
    const { batteryPercent, latitude, longitude } = req.body;
    const state = await TrailheadTemporalManager.signalLowBattery(id, {
      batteryPercent: Number(batteryPercent),
      latitude: Number(latitude),
      longitude: Number(longitude),
    });
    res.json({ success: true, message: "Battery status and GPS telemetry received.", state });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. Query: Get Real-time Workflow State
app.get("/api/workflow/:id/state", async (req, res) => {
  try {
    const { id } = req.params;
    const state = await TrailheadTemporalManager.getWorkflowState(id);
    res.json({ success: true, state });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n========================================================`);
  console.log(`🌲 Trailhead Promise Server active on http://localhost:${PORT}`);
  console.log(`📡 Open in browser for the screen-free voice interface`);
  console.log(`========================================================\n`);
});
