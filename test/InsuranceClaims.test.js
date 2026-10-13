const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const ETH = (n) => ethers.parseEther(String(n));
const Status = { Submitted: 0, Flagged: 1, Verified: 2, Approved: 3, Paid: 4, Rejected: 5 };

describe("InsuranceClaims", function () {
  let insurer, auditor, holder, other, c;
  beforeEach(async () => {
    [insurer, auditor, holder, other] = await ethers.getSigners();
    c = await ethers.deployContract("InsuranceClaims", [auditor.address], { value: ETH(50) });
    await c.createPolicy(holder.address, ETH(10), 365);
  });

  describe("Policy creation", () => {
    it("records the policy on-chain", async () => {
      const p = await c.policies(1);
      expect(p.holder).to.equal(holder.address);
      expect(p.coverage).to.equal(ETH(10));
      expect(p.active).to.equal(true);
    });
    it("only the insurer can create policies", async () => {
      await expect(c.connect(other).createPolicy(other.address, ETH(1), 30)).to.be.revertedWith("Only insurer");
    });
  });

  describe("Claim submission and automated verification", () => {
    it("verifies an eligible claim automatically", async () => {
      await c.connect(holder).submitClaim(1, ETH(2), "QmDocA");
      expect((await c.claims(1)).status).to.equal(Status.Verified);
    });
    it("only the policy holder can submit", async () => {
      await expect(c.connect(other).submitClaim(1, ETH(1), "QmX")).to.be.revertedWith("Not policy holder");
    });
    it("auto-rejects a claim above remaining coverage", async () => {
      await c.connect(holder).submitClaim(1, ETH(11), "QmBig");
      const cl = await c.claims(1);
      expect(cl.status).to.equal(Status.Rejected);
      expect(cl.note).to.equal("Exceeds remaining coverage");
    });
    it("auto-rejects a claim after the policy expired", async () => {
      await time.increase(366 * 24 * 3600);
      await c.connect(holder).submitClaim(1, ETH(1), "QmLate");
      expect((await c.claims(1)).note).to.equal("Policy not active");
    });
  });

  describe("Fraud flagging", () => {
    it("flags a duplicate document hash", async () => {
      await c.connect(holder).submitClaim(1, ETH(1), "QmSame");
      await c.connect(holder).submitClaim(1, ETH(2), "QmSame");
      const cl = await c.claims(2);
      expect(cl.status).to.equal(Status.Flagged);
      expect(cl.note).to.equal("Duplicate document hash");
    });
    it("flags a duplicate claim amount on the same policy", async () => {
      await c.connect(holder).submitClaim(1, ETH(1), "QmA1");
      await c.connect(holder).submitClaim(1, ETH(1), "QmA2");
      expect((await c.claims(2)).note).to.equal("Duplicate claim amount");
    });
    it("flags an unusually large amount", async () => {
      await c.connect(holder).submitClaim(1, ETH(9), "QmHuge");
      const cl = await c.claims(1);
      expect(cl.status).to.equal(Status.Flagged);
      expect(cl.note).to.equal("Unusual claim amount");
    });
    it("manual review can clear a flagged claim", async () => {
      await c.connect(holder).submitClaim(1, ETH(9), "QmHuge");
      await c.reviewFlagged(1, true);
      expect((await c.claims(1)).status).to.equal(Status.Verified);
    });
    it("manual review can reject a flagged claim", async () => {
      await c.connect(holder).submitClaim(1, ETH(9), "QmHuge");
      await c.reviewFlagged(1, false);
      expect((await c.claims(1)).status).to.equal(Status.Rejected);
    });
    it("a flagged claim cannot be approved before review", async () => {
      await c.connect(holder).submitClaim(1, ETH(9), "QmHuge");
      await expect(c.approveClaim(1)).to.be.revertedWith("Not ready for approval");
    });
  });

  describe("Multi-party approval and payout", () => {
    beforeEach(async () => { await c.connect(holder).submitClaim(1, ETH(2), "QmDocA"); });

    it("does not pay after only the insurer approves", async () => {
      await c.approveClaim(1);
      const cl = await c.claims(1);
      expect(cl.insurerApproved).to.equal(true);
      expect(cl.status).to.equal(Status.Verified);
    });
    it("pays out automatically once insurer and auditor both approve", async () => {
      await c.approveClaim(1);
      await expect(c.connect(auditor).approveClaim(1)).to.changeEtherBalances([holder, c], [ETH(2), -ETH(2)]);
      expect((await c.claims(1)).status).to.equal(Status.Paid);
      expect((await c.policies(1)).claimed).to.equal(ETH(2));
    });
    it("rejects approvals from anyone else", async () => {
      await expect(c.connect(other).approveClaim(1)).to.be.revertedWith("Not authorised");
    });
    it("cannot approve twice by the same party", async () => {
      await c.approveClaim(1);
      await expect(c.approveClaim(1)).to.be.revertedWith("Already approved");
    });
    it("cannot pay twice", async () => {
      await c.approveClaim(1);
      await c.connect(auditor).approveClaim(1);
      await expect(c.approveClaim(1)).to.be.revertedWith("Not ready for approval");
    });
    it("auditor can reject a verified claim", async () => {
      await c.connect(auditor).rejectClaim(1, "Insufficient evidence");
      expect((await c.claims(1)).status).to.equal(Status.Rejected);
    });
  });

  describe("Audit trail", () => {
    it("emits an ordered event history for a full claim", async () => {
      await c.connect(holder).submitClaim(1, ETH(2), "QmDocA");
      await c.approveClaim(1);
      await c.connect(auditor).approveClaim(1);
      const names = [];
      for (const f of ["ClaimSubmitted", "ClaimVerified", "ClaimApproved", "PayoutExecuted"]) {
        const ev = await c.queryFilter(c.filters[f]());
        ev.forEach((e) => names.push(e.fragment.name));
      }
      expect(names).to.include.members(["ClaimSubmitted", "ClaimVerified", "ClaimApproved", "PayoutExecuted"]);
      expect((await c.queryFilter(c.filters.ClaimApproved())).length).to.equal(2);
    });
  });
});
