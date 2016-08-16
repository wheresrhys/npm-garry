<tree>
  <p>{ opts.package }</p>
  <ul>
    <li each={ dependencies }>
      <tree>
    </li>
  </ul>
  <script>
    this.dependencies = opts.dependencies
  </script>

</tree>
