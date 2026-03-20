"use client";

import { SignInButton } from "@clerk/nextjs";

import { Button } from "@/components/ui/button";

export function UnauthenticatedView() {
	return (
		<main className="flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-sm">
				<h1 className="text-lg font-semibold text-foreground">Sign in required</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					Please sign in to access your workspace.
				</p>
				<div className="mt-5 flex justify-center">
					<SignInButton mode="modal">
						<Button>Sign in</Button>
					</SignInButton>
				</div>
			</div>
		</main>
	);
}
