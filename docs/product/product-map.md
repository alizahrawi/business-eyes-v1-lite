# Business Eyes Product Map

Business Eyes is the umbrella product. Individual capabilities are organized as independent applications or shared packages.

```text
Business Eyes
├── Work Reporting
│   └── Daily Report Builder              Active — v1 Lite
├── Management Intelligence
│   ├── Performance Analytics             Planned
│   └── Decision-ready Insights           Planned
├── Team Operations
│   ├── Workflow Intelligence             Planned
│   └── Reporting Standards               Planned
└── Ecosystem
    ├── Task-manager Integrations          Planned
    └── Shared AI and Data Capabilities    Future shared packages
```

## Repository mapping

| Product concept | Repository location |
| --- | --- |
| Deployable products | `apps/<product-name>/` |
| Shared code introduced by multiple products | `packages/<package-name>/` |
| Product strategy and origin | `docs/product/` |
| Product-specific technical diagrams | `docs/architecture/<product-name>/` |
| Repository-wide security policy | `SECURITY.md` |

The repository does not create empty future applications. A new folder should be added only when that product has an approved scope and implementation work begins.

