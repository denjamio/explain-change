/** An error the user can act on: printed without a stack trace, with exit code 2. */
export class UserError extends Error {
  override name = "UserError";
}
