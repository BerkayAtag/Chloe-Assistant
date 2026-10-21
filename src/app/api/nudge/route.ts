import { NextResponse } from 'next/server';
import { localRequestAllowed } from '@/lib/request-origin';
import { checkNudges, buildNudgeContext, analyzeText } from '@/lib/nudge';

export const maxDuration = 10;
export async function POST(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Yerel Chloe isteği gerekli.' }, { status: 403 });
  try {
    const body = await request.json();
    const { assistantText, hasUserFollowedUp = false } = body;
    if (typeof assistantText !== 'string') throw new Error('assistantText gerekli.');
    const ctx = buildNudgeContext(assistantText, hasUserFollowedUp);
    const nudge = checkNudges(ctx);
    if (!nudge) return NextResponse.json({ nudge: null, analysis: analyzeText(assistantText) }, { headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ nudge: { id: nudge.trigger.id, text: nudge.text, cooldown: nudge.trigger.cooldown }, analysis: analyzeText(assistantText) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Bilinmeyen hata.' }, { status: 400 });
  }
}
