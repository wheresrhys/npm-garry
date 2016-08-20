import { h, render, Component } from 'preact';

var nsp = '/api/package/${ctx.query.package}'
const socket = io('/');


class Tree extends Component {
    constructor({tree, top}) {
        super();
        if (top) {
	        socket.emit('package', packageName)
					socket.on('tree', data => {
					    this.setState({tree: data});
					});
					this.state.tree = {name: packageName, dependencies: {}}
				} else {
					this.state.tree = tree;
				}
    }


    render() {
    	const tree = this.props.tree || this.state.tree;
        return <div class={"tree" + (tree.complete ? " complete" : " incomplete")} >
  <p>{ tree.name }, { tree.version }, { tree.range } </p>

  <ul>
  { Object.keys(tree.dependencies).map(dep => (
			<li>
				<Tree tree={tree.dependencies[dep]} />
			</li>
		)) }
  </ul>
</div>
    }
}


render(<Tree top="true"/>, document.getElementById('tree'));