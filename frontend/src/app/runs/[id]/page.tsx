"use client";
import * as React from "react";
import { MissionControl } from "@/components/mission/MissionControl";

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  return <MissionControl runId={id} />;
}
