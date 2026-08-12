"use client";

import { useFormStatus } from "react-dom";

export function PendingSubmitButton({
  children,
  pendingText,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pendingText: string }) {
  const { pending } = useFormStatus();
  return <button {...props} disabled={pending || props.disabled} aria-disabled={pending || props.disabled}>
    {pending ? pendingText : children}
  </button>;
}
