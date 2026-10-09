import { NextRequest } from 'next/server';
import { respondToChallengeInvite } from '../respond-to-invite';

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return respondToChallengeInvite(request, ctx, 'accepted');
}
