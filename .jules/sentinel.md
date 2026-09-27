## 2024-05-18 - SQL Injection in Frontend API Queries
**Vulnerability:** Direct string interpolation of user-controlled variables (`id` or `m.id`) into SQL query strings executed by the frontend via the `/dynamicapi/read` endpoint.
**Learning:** The architecture of this application allows the frontend to directly construct and execute SQL queries against the backend. This means that frontend variables used in these queries must be strictly sanitized to prevent SQL injection.
**Prevention:** Always use `String(s).replace(/'/g, "''")` or similar sanitization when interpolating variables into SQL strings constructed on the frontend.
