import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/** Canonical: `discrete` (byte-identical to `pick_to_tote`). */
export function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/**
 * Errors the plan layer treats as "this draft is stale" rather than "the request blew up".
 * Anything else propagates untouched.
 */
export function isPlanValidationError(
  error: unknown,
): error is BadRequestException | ConflictException | NotFoundException {
  return (
    error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException
  );
}

/**
 * Canonical: `discrete` (byte-identical to `pick_to_tote`).
 * `aggregate_then_sort` carried a looser `(error: unknown) => error.message` variant; for the
 * exceptions this layer actually throws the two return the same string, because Nest copies a
 * string `response.message` onto `.message`. This version additionally survives array messages.
 */
export function errorMessage(error: BadRequestException | ConflictException | NotFoundException): string {
  const response = error.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: string | string[] }).message;
  if (Array.isArray(message)) return message.join('; ');
  return message ?? error.message;
}
