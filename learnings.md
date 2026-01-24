# Learnings from Database Editor Playground Development


## Observables-React Patterns

### ViewModel Pattern

- Use `ViewModel({...})` factory function, not `BaseViewModel<...>` with static `_props`:
  ```typescript
  // Good
  class MyViewModel extends ViewModel({
    playground: inject(PlaygroundViewModelKey),
  }) { ... }

  // Bad
  class MyViewModel extends BaseViewModel<{ playground: PlaygroundViewModel }> {
    static readonly _props = { playground: inject(PlaygroundViewModelKey) };
  }
  ```

### Use `view` for Stateless Components

- When a component doesn't need ViewModel state, use `view` instead of `viewWithModel`:
  ```typescript
  const SqlStatementsPreview = view(
    { statements: prop<SqlStatement[]>() },
    (reader, props) => { ... }
  );
  ```

### Don't Create Setter Methods for Public Observables

- When an `observableValue` is public, consumers can call `.set()` directly:
  ```typescript
  // Good - direct access
  this.props.playground.sqlContent.set(value, undefined);

  // Bad - redundant wrapper
  setSqlContent(sql: string): void {
    this.sqlContent.set(sql, undefined);
  }
  ```

### Use ObservablePromise for Async Derived State

- Replace imperative `autorun` + async methods with `derivedObservableWithCache` + `ObservablePromise`:
  ```typescript
  private readonly _sqlExecution = derivedObservableWithCache<ObservablePromise<DatabaseState | null> | undefined>(
    this,
    (reader, lastPromise) => {
      const sql = this._debouncedSql.read(reader);
      if (!sql.trim()) return undefined;
      return ObservablePromise.fromFn(() => this._executeSql(sql, lastPromise));
    }
  );

  readonly databaseState = derived(this, (reader) => {
    const promise = this._sqlExecution.read(reader);
    if (!promise) return null;
    const result = promise.promiseResult.read(reader);
    return result?.data ?? null;
  });
  ```

### Pass Data as Props, Not via Protected Access

- Don't access protected `props` from render functions; declare data as props in `viewWithModel`:
  ```typescript
  // Good - declare in viewWithModel props
  const SqlStatementsPreview = viewWithModel(
    SqlStatementsViewModel,
    { statements: prop<SqlStatement[]>() },
    (reader, vm, props) => {
      const statements = props.statements.read(reader);
    }
  );
  ```

## Code Organization

- **Place each ViewModel directly above its corresponding view** - improves readability and makes the relationship between ViewModel and View explicit
- **Avoid callbacks in render functions** - use ViewModel methods instead:
  ```typescript
  // Good
  onChange={(value) => vm.handleSqlChange(value ?? "")}

  // Bad - inline logic
  onChange={(value) => { /* complex logic here */ }}
  ```
