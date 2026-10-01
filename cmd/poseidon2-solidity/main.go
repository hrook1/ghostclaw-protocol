package main

import (
	"bytes"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/consensys/gnark-crypto/ecc/bn254/fr/poseidon2"
)

const field = "21888242871839275222246405745257275088548364400416034343698204186575808495617"

func main() {
	output := flag.String("out", "contracts/generated/GhostClawPoseidon2BN254.sol", "generated Solidity output")
	flag.Parse()
	parameters := poseidon2.GetDefaultParameters()
	if parameters.Width != 2 || parameters.NbFullRounds != 6 || parameters.NbPartialRounds != 50 {
		panic("unexpected Gnark Poseidon2 parameters")
	}

	var source bytes.Buffer
	source.WriteString("// SPDX-License-Identifier: Apache-2.0\n")
	source.WriteString("// Code generated from gnark-crypto v0.20.1. DO NOT EDIT.\n")
	source.WriteString("pragma solidity ^0.8.30;\n\n")
	source.WriteString("contract GhostClawPoseidon2BN254 {\n")
	fmt.Fprintf(&source, "    uint256 public constant FIELD = %s;\n", field)
	source.WriteString("    error FieldElementOutOfRange();\n\n")
	source.WriteString("    function hashPair(uint256 left, uint256 right) external pure returns (uint256) {\n")
	source.WriteString("        if (left >= FIELD || right >= FIELD) revert FieldElementOutOfRange();\n")
	source.WriteString("        uint256 x0 = addmod(addmod(left, left, FIELD), right, FIELD);\n")
	source.WriteString("        uint256 x1 = addmod(left, addmod(right, right, FIELD), FIELD);\n")

	round := 0
	for ; round < parameters.NbFullRounds/2; round++ {
		writeKeys(&source, parameters, round)
		writeFullRound(&source)
	}
	for ; round < parameters.NbFullRounds/2+parameters.NbPartialRounds; round++ {
		writeKeys(&source, parameters, round)
		writePartialRound(&source)
	}
	for ; round < parameters.NbFullRounds+parameters.NbPartialRounds; round++ {
		writeKeys(&source, parameters, round)
		writeFullRound(&source)
	}
	source.WriteString("        return addmod(x1, right, FIELD);\n")
	source.WriteString("    }\n\n")
	source.WriteString("    function _pow5(uint256 value) private pure returns (uint256) {\n")
	source.WriteString("        uint256 square = mulmod(value, value, FIELD);\n")
	source.WriteString("        return mulmod(mulmod(square, square, FIELD), value, FIELD);\n")
	source.WriteString("    }\n")
	source.WriteString("}\n")

	formatted := source.Bytes()
	if err := os.MkdirAll(filepath.Dir(*output), 0o755); err != nil {
		panic(err)
	}
	if err := os.WriteFile(*output, formatted, 0o644); err != nil {
		panic(err)
	}
}

func writeKeys(source *bytes.Buffer, parameters *poseidon2.Parameters, round int) {
	for lane, key := range parameters.RoundKeys[round] {
		name := fmt.Sprintf("x%d", lane)
		fmt.Fprintf(source, "        %s = addmod(%s, %s, FIELD);\n", name, name, key.String())
	}
}

func writeFullRound(source *bytes.Buffer) {
	source.WriteString("        x0 = _pow5(x0);\n")
	source.WriteString("        x1 = _pow5(x1);\n")
	source.WriteString("        (x0, x1) = (addmod(addmod(x0, x0, FIELD), x1, FIELD), addmod(x0, addmod(x1, x1, FIELD), FIELD));\n")
}

func writePartialRound(source *bytes.Buffer) {
	source.WriteString("        x0 = _pow5(x0);\n")
	source.WriteString("        (x0, x1) = (addmod(addmod(x0, x0, FIELD), x1, FIELD), addmod(x0, mulmod(x1, 3, FIELD), FIELD));\n")
}
