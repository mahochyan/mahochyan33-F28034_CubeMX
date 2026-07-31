const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
global.DeterministicJSON = require('../src/core/deterministic_json.js');
global.ResourceGraph = require('../src/core/resource_graph.js');
global.PeripheralConstraints = require('../src/core/peripheral_constraints.js');
global.ConstraintChecker = require('../src/core/constraint_checker.js');

const Loader = require('../src/core/device_loader.js');
const Project = require('../src/core/project_config.js');
const Codegen = require('../src/core/codegen.js');
const read = relative => JSON.parse(
  fs.readFileSync(path.join(root, relative), 'utf8'));
const pinmux = read('src/devices/TMS320F28034/pinmux.json');
const family = read('src/devices/TMS320F28034/family.json');
const signalGroups = read('src/devices/TMS320F28034/signal_groups.json');
const internalRoutes = read('src/devices/TMS320F28034/internal_routes.json');
const peripheralInstances =
  read('src/devices/TMS320F28034/peripheral_instances.json');
const reverseIndex = Loader.buildReverseIndex(pinmux);
const context = {
  pinmux, family, signalGroups, internalRoutes, peripheralInstances,
};

function editor(functionId, selectedPin, draft = {}) {
  return {
    source: 'test',
    functionId,
    candidatePins: reverseIndex[functionId],
    selectedPin,
    status: 'editing',
    draft: { function: functionId, selectedPin, ...draft },
  };
}

function plan(project, activeEditor) {
  return Project.buildCommitPlan({
    project,
    editor: activeEditor,
    pinmux,
    reverseIndex,
    signalGroups,
    internalRoutes,
  });
}

function commit(project, activeEditor) {
  const transaction = plan(project, activeEditor);
  if (!transaction.ok) {
    throw new Error(transaction.errors.join('；'));
  }
  return Project.applyAtomically(project, transaction);
}

module.exports = {
  root,
  Project,
  Codegen,
  pinmux,
  family,
  signalGroups,
  internalRoutes,
  peripheralInstances,
  reverseIndex,
  context,
  editor,
  plan,
  commit,
};
