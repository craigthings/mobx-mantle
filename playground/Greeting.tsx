import { ViewModel, createComponent } from '../src';

interface GreetingProps {
  name: string;
}

class GreetingVM extends ViewModel<GreetingProps> {
  expanded = false;

  get message() {
    return `Hello, ${this.props.name}!`;
  }

  toggleExpanded() {
    this.expanded = !this.expanded;
  }
}

export default createComponent(GreetingVM, (vm) => (
  <div className="greeting" onClick={vm.toggleExpanded}>
    <span>{vm.message}</span>
    {vm.expanded && (
      <p className="greeting-detail">
        This component uses the separated ViewModel pattern.
      </p>
    )}
  </div>
));
