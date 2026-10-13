'use client';
import { motion } from 'framer-motion';

export default function Avatar({
  isSpeaking,
  assistantName = 'Chloe',
  src = '/chloe-portrait.jpg',
}: {
  isSpeaking: boolean;
  assistantName?: string;
  src?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative flex justify-center items-center w-48 h-48">
        {isSpeaking && (
          <>
            <motion.div
              className="absolute w-full h-full rounded-full border-4 border-app-accent opacity-50"
              animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
            />
            <motion.div
              className="absolute w-full h-full rounded-full border-4 border-app-accent/50 opacity-50"
              animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0, 0.4] }}
              transition={{ repeat: Infinity, duration: 1.8 }}
            />
          </>
        )}

        <div className="relative w-36 h-36 rounded-full overflow-hidden border-4 border-app-accent/40 shadow-lg shadow-app-accent/15 z-10 bg-night-800 dark:bg-night-850 flex items-center justify-center">
          {/* Chloe — yerel görsel (ağa bağımlı değil, her zaman yüklenir) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={assistantName}
            className="w-full h-full object-cover"
            draggable={false}
          />
        </div>
      </div>
      <h2 className="mt-4 text-2xl font-light tracking-[0.2em] text-app-accent dark:text-app-accent uppercase">
        {assistantName}
      </h2>
    </div>
  );
}
