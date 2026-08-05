import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Unmount anything a test rendered.
 *
 * Testing Library only auto-cleans when vitest runs with `globals: true`, which
 * this project does not. Without it, renders accumulate across tests in a file
 * and every query fails with "found multiple elements".
 */
afterEach(cleanup);
