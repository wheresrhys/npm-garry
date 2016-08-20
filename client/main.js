import { h, render, Component } from 'preact';

var nsp = '/api/package/${ctx.query.package}'
const socket = io('/');


class Tree extends Component {
    constructor({tree, top}) {
        super();
        if (top) {
	        socket.emit('package', JSON.stringify(packageDetails))
					socket.on('tree', data => {
					    this.setState({tree: data});
					});
					this.state.tree = {name: packageDetails.name, dependencies: {}}
				} else {
					this.state.tree = tree;
				}
    }


    render() {
    	const tree = this.props.tree || this.state.tree;
        return <div class={"tree" + (tree.complete ? " complete" : " incomplete")} >
  <p><a href={"/package?package=" + tree.name}>{ tree.name }</a>,
  <a href={"/package?package="  + tree.name + "&version=" + tree.version }>{ tree.version }</a>,
  <a href={"/package?package="  + tree.name + "&version=" + tree.range }>{ tree.range }</a></p>

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