import type { AIPageState, PlatformId } from "../../common/messaging";

export type DetectorSnapshot = {
  state: AIPageState;
  reason: string;
  meta?: {
    textHash?: string;
    textLength?: number;
  };
};

export interface Detector {
  platform: PlatformId;
  init(): void;
  destroy(): void;
  getCurrentState(): AIPageState;
}
