---
description: "Machine-learning evaluation and model-governance requirements. Distractor unless the task changes an ML model or AI decision pipeline."
applyTo: "ml/**/*,models/**/*,notebooks/**/*"
tags: [ml, governance]
---

# ML model governance

Apply only when changing a trained model, model evaluation, model-serving decision logic, or dataset used for such a model.

- Record dataset/evaluation provenance and pin model artifacts used for comparison.
- Separate offline quality metrics from product/business outcomes.
- Evaluate important slices rather than reporting aggregate accuracy alone.
- Do not ship a changed decision model without reproducible comparison evidence.

This rule is a deliberate distractor for ordinary application engineering tasks.
