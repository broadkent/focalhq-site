// One display-space cel palette for both teaching studies. Apply after exposure
// and output color conversion so camera and bust cannot drift into different inks.
export const PRINT_TONES=Object.freeze([.20,.46,.70,.89]);
export const PRINT_TONE_GLSL=`
  float focalPrintInk(float gray) {
    return gray < 0.43 ? 0.20 : (gray < 0.65 ? 0.46 : (gray < 0.81 ? 0.70 : 0.89));
  }
`;
