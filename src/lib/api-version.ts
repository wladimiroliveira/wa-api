// The version lives here alone. Routes declare their own path and know nothing about it, so a v2 is
// a second route module registered under a second prefix, not a rename spread over every file.
export const API_VERSION = "v1";
export const API_PREFIX = `/${API_VERSION}`;
