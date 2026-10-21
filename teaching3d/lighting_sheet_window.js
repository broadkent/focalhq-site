// The view window for the open light sheet (Kent, October 16, 2026): with the sheet down the bust sits
// centered in the full view, with it up centered in the band from just under the title bar to just above
// the Light row, at the SAME size (22:40: "This is the correct thing that should happen"). So the window
// only pans: the host sends the open band and the same band with the sheet collapsed (fractions of the
// canvas height from its top), and the projection moves up by the difference of their centers, eased
// in by [blend] as the sheet rises. Nothing here reads the bust, the zoom or the orbit, so whatever the
// learner has done with the sheet up (turned, dollied, zoomed) is left as it is, going up and coming
// down. History: #775 fitted the measured bust into the band and scaled it to fit; with the tall light
// panel that shrank the bust, and closing the sheet scaled it back up past the screen edges.
// Only the projection moves: the camera's position, aim and zoom stay (see applyViewFrame and
// eyeFraming in lighting.js, which ignore these terms).

/// The lens `sheet` shift (added to shiftY; positive moves the picture up) and the `sheetZoom` factor
/// (always 1: a pan never scales) for the open [band] ([top, bottom]) against the collapsed band's
/// [closedBottom], [blend] 0 (closed) to 1 (open).
export function sheetWindow({band,closedBottom,blend=1}){
  const [top,bottom]=band;
  if(![top,bottom,closedBottom,blend].every(Number.isFinite)||bottom<=top)return {sheet:0,sheetZoom:1};
  const k=Math.min(1,Math.max(0,blend));
  return {sheet:k*(closedBottom-bottom)/2,sheetZoom:1};
}
