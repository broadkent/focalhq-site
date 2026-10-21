// Shared layout facts for the schematic camera.  Keep the optical assembly
// together so its front and rear teaching parts stay aligned when the body
// proportions change.
export const CAMERA_LAYOUT = Object.freeze({
  bodyWidth: 4.1,
  bodyDepth: 0.85,
  bodyCenterZ: -0.38,
  opticalCenterX: 0.5,
  gripCenterX: -1.5,
  gripWidth: 0.95,
  frontOpeningRadius: 1.03,
  widestMountRadius: 1.14,
  minimumGripClearance: 0.3,
  viewfinderWidth: 1.18,
  controlDialRadius: 0.3,
  controlDialClearance: 0.16,
});
