
## 2024-10-24 - SQL Injection in Device Parameter
**Vulnerability:** SQL Injection in dynamic device or meter id variables within API wrapper.
**Learning:** Variables embedded in template strings to build SQL queries passed to the '/dynamicapi/read' endpoint were not sanitized, resulting in severe SQL injection vulnerabilities if device ids were crafted by a malicious user.
**Prevention:** All user inputs and embedded variables used in SQL queries must be sanitized via `String(var).replace(/'/g, "''")` or alternatively query parameterization should be used where possible.
