"""校验设计契约和示例；不替代真实 API、业务规则或数据库测试。"""
from pathlib import Path
import json
from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate_spec
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

base = Path(__file__).resolve().parent
contract = json.loads((base / 'openapi.json').read_text())
examples = json.loads((base / 'examples.json').read_text())
validate_spec(contract)
resource = Resource.from_contents(contract, default_specification=DRAFT202012)
registry = Registry().with_resource('urn:kith:api', resource)
for name, schema in contract['components']['schemas'].items():
    Draft202012Validator.check_schema(schema)

for group in ('valid', 'invalid'):
    for case in examples[group]:
        validator = Draft202012Validator(
            {'$ref': f"urn:kith:api#/components/schemas/{case['schema']}"},
            registry=registry,
            format_checker=FormatChecker(),
        )
        errors = list(validator.iter_errors(case['value']))
        if group == 'valid' and errors:
            raise AssertionError(f"{case['name']}: {errors[0].message}")
        if group == 'invalid' and not errors:
            raise AssertionError(f"未拒绝无效样例：{case['name']}")

operations = [op for path in contract['paths'].values() for op in path.values()]
ids = [op['operationId'] for op in operations]
assert len(ids) == len(set(ids)), 'operationId 重复'
assert all(op['responses'] for op in operations)
print(f"OpenAPI有效；{len(ids)}个操作、{len(examples['valid'])}个通过样例、{len(examples['invalid'])}个拒绝样例符合schema。")
print('尚未运行真实API、跨字段业务校验、持久化、微信真机或恢复删除演练。')
