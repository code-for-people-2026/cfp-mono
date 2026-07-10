type AccessArgs = { req: { user?: unknown } };

export function cmsAuthenticated({ req }: AccessArgs): boolean {
  return Boolean(req.user);
}
