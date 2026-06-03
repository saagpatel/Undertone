import { FRAME_SIZE } from "./sine-a4";

/** Zero-amplitude frame — must read as silence (frequency 0, rms below floor). */
export const silence = new Float32Array(FRAME_SIZE);
