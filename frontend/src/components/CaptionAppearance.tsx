import type { CSSProperties } from 'react';
import type { CaptionStyle } from '../api/types';

export const defaultCaptionStyle: CaptionStyle = {
  font: 'Arial', size: 22, color: '#FFFFFF', outline_color: '#000000', background_color: '#000000',
  background: false, bold: true, italic: false, position: 'bottom', align: 'center', margin: 24, outline: 2, shadow: 0,
};

export function captionTextStyle(style: CaptionStyle): CSSProperties {
  return { fontFamily: style.font, fontSize: `${style.size / 288 * 100}cqh`, color: style.color,
    fontWeight: style.bold ? 700 : 400, fontStyle: style.italic ? 'italic' : 'normal',
    backgroundColor: style.background ? style.background_color : 'transparent',
    WebkitTextStroke: style.background ? undefined : `${style.outline * 0.6}px ${style.outline_color}`,
    paintOrder: 'stroke fill', textShadow: style.shadow ? `${style.shadow}px ${style.shadow}px ${style.shadow + 1}px ${style.background_color}` : undefined,
  };
}

export function CaptionOverlay({ style, text }: { style: CaptionStyle; text: string }) {
  return <div className="pointer-events-none absolute inset-0 flex px-[5%]" style={{ alignItems: style.position === 'top' ? 'flex-start' : style.position === 'middle' ? 'center' : 'flex-end', justifyContent: style.align === 'left' ? 'flex-start' : style.align === 'right' ? 'flex-end' : 'center', top: `${style.margin / 288 * 100}%`, bottom: `${style.margin / 288 * 100}%` }}>
    <span className="max-w-full whitespace-pre-line px-2 py-1" style={{ ...captionTextStyle(style), textAlign: style.align }}>{text}</span>
  </div>;
}
