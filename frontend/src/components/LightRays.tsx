/**
 * LightRays — Animated falling light beams overlay.
 * Pure CSS animation driven, no JS runtime cost.
 * Sits fixed behind content with pointer-events: none.
 */
export default function LightRays() {
  return (
    <div className="light-rays">
      {/* 12 rays with varying widths, speeds, and delays defined in index.css */}
      <div className="light-ray" />
      <div className="light-ray" />
      <div className="light-ray" />
      <div className="light-ray" />
      <div className="light-ray" />
      <div className="light-ray" />
      <div className="light-ray" />
      <div className="light-ray" />
      <div className="light-ray" />
      <div className="light-ray" />
      <div className="light-ray" />
      <div className="light-ray" />
    </div>
  );
}
