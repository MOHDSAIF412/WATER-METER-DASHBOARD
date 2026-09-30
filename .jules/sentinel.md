## 2026-09-30 - Fix SQL Injection
**Vulnerability:** Raw SQL queries are constructed directly in the frontend and sent to an API endpoint (`/dynamicapi/read`), which executes them on the database.
**Learning:** Due to this architecture, we have to sanitize string variables like `m.id`, `CONFIG.ORG`, etc., before string interpolation to prevent SQL injection, using double single-quotes (`''`).
**Prevention:** Implement `escSql` function that runs `String(s).replace(/'/g, "''")` and apply it consistently on parameters interpolated in `sql()` query construction.
