"use client";

/**
 * Open source version of the Waitlist Admin page. The waitlist is a hosted
 * (SaaS) feature and is not part of Momentum; the tab is hidden, but the
 * #waitlist hash still resolves here, so render a neutral notice.
 */
export default function WaitlistPage() {
  return (
    <div className="rounded-lg bg-muted p-6">
      <h2 className="mb-2 text-2xl font-bold">Waitlist</h2>
      <p className="text-muted-foreground">
        Waitlist management is not available in Momentum.
      </p>
    </div>
  );
}
