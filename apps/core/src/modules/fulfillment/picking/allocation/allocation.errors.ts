import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/** Canonical: `discrete` (byte-identical to `pick_to_tote`). */
export function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/**
 * Errors batch preparation treats as a business rejection (a durable `preparation_blocked` marker)
 * rather than "the request blew up". Anything else propagates untouched.
 */
export function isPlanValidationError(
  error: unknown,
): error is BadRequestException | ConflictException | NotFoundException {
  return (
    error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException
  );
}
