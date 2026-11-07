"use client";

import { useState } from "react";
import { btn } from "../../../../_ui/ui";
import ListingPicker from "./listing-picker";

// "Change property" button that opens the listing search in place.
export default function ChangeListing({ appointmentId, currentId }: { appointmentId: string; currentId: string | null }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${btn.ghost} ${btn.small}`}>
        Change property
      </button>
    );
  }
  return (
    <div className="mt-4 w-full rounded-md border border-gray-200 p-3">
      <ListingPicker appointmentId={appointmentId} currentId={currentId} onDone={() => setOpen(false)} />
    </div>
  );
}
