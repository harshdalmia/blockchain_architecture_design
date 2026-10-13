// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Decentralized insurance claim processing with rule-based fraud flags
/// @notice Policies, claims, approvals and payouts are recorded on-chain.
///         Claim documents live on IPFS; only their hash (CID) is stored here.
contract InsuranceClaims {
    enum Status { Submitted, Flagged, Verified, Approved, Paid, Rejected }

    struct Policy {
        address holder;
        uint256 coverage;      // max total payout (wei)
        uint256 claimed;       // total paid or reserved so far (wei)
        uint64 startTime;
        uint64 endTime;
        bool active;
    }

    struct Claim {
        uint256 policyId;
        address claimant;
        uint256 amount;
        string ipfsHash;
        uint64 submittedAt;
        Status status;
        bool insurerApproved;
        bool auditorApproved;
        string note;           // flag reason or rejection reason
    }

    address public immutable insurer;
    address public immutable auditor;

    // Fraud rule parameter: claims above this share of coverage are "unusual"
    uint256 public constant UNUSUAL_PERCENT = 80;

    uint256 public policyCount;
    uint256 public claimCount;
    mapping(uint256 => Policy) public policies;
    mapping(uint256 => Claim) public claims;
    mapping(bytes32 => bool) private usedHash;                    // duplicate document check
    mapping(uint256 => mapping(uint256 => bool)) private usedAmount; // policy => amount => seen

    // Audit trail
    event PolicyCreated(uint256 indexed policyId, address indexed holder, uint256 coverage, uint64 startTime, uint64 endTime);
    event PoolFunded(address indexed from, uint256 amount);
    event ClaimSubmitted(uint256 indexed claimId, uint256 indexed policyId, address indexed claimant, uint256 amount, string ipfsHash);
    event ClaimFlagged(uint256 indexed claimId, string reason);
    event ClaimVerified(uint256 indexed claimId);
    event FlagReviewed(uint256 indexed claimId, bool cleared, address reviewer);
    event ClaimApproved(uint256 indexed claimId, address indexed approver, string role);
    event ClaimRejected(uint256 indexed claimId, address indexed by, string reason);
    event PayoutExecuted(uint256 indexed claimId, address indexed to, uint256 amount);

    modifier onlyInsurer() { require(msg.sender == insurer, "Only insurer"); _; }

    constructor(address _auditor) payable {
        require(_auditor != address(0) && _auditor != msg.sender, "Bad auditor");
        insurer = msg.sender;
        auditor = _auditor;
        if (msg.value > 0) emit PoolFunded(msg.sender, msg.value);
    }

    function fundPool() external payable {
        emit PoolFunded(msg.sender, msg.value);
    }

    function poolBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function createPolicy(address holder, uint256 coverage, uint64 durationDays) external onlyInsurer returns (uint256 id) {
        require(holder != address(0) && coverage > 0 && durationDays > 0, "Bad policy");
        id = ++policyCount;
        policies[id] = Policy(holder, coverage, 0, uint64(block.timestamp), uint64(block.timestamp + uint256(durationDays) * 1 days), true);
        emit PolicyCreated(id, holder, coverage, uint64(block.timestamp), uint64(block.timestamp + uint256(durationDays) * 1 days));
    }

    /// @notice Submit a claim. Eligibility is checked automatically, then fraud rules run.
    function submitClaim(uint256 policyId, uint256 amount, string calldata ipfsHash) external returns (uint256 id) {
        Policy storage p = policies[policyId];
        require(p.holder == msg.sender, "Not policy holder");
        require(amount > 0 && bytes(ipfsHash).length > 0, "Bad claim");

        id = ++claimCount;
        Claim storage c = claims[id];
        c.policyId = policyId;
        c.claimant = msg.sender;
        c.amount = amount;
        c.ipfsHash = ipfsHash;
        c.submittedAt = uint64(block.timestamp);
        emit ClaimSubmitted(id, policyId, msg.sender, amount, ipfsHash);

        // 1. Automated eligibility
        if (!p.active || block.timestamp < p.startTime || block.timestamp > p.endTime) {
            _reject(id, address(this), "Policy not active");
            return id;
        }
        if (amount > p.coverage - p.claimed) {
            _reject(id, address(this), "Exceeds remaining coverage");
            return id;
        }

        // 2. Rule-based fraud checks
        bytes32 h = keccak256(bytes(ipfsHash));
        string memory reason = "";
        if (usedHash[h]) reason = "Duplicate document hash";
        else if (usedAmount[policyId][amount]) reason = "Duplicate claim amount";
        else if (amount * 100 > p.coverage * UNUSUAL_PERCENT) reason = "Unusual claim amount";
        usedHash[h] = true;
        usedAmount[policyId][amount] = true;

        if (bytes(reason).length > 0) {
            c.status = Status.Flagged;
            c.note = reason;
            emit ClaimFlagged(id, reason);
        } else {
            c.status = Status.Verified;
            emit ClaimVerified(id);
        }
    }

    /// @notice Manual review of a flagged claim by the insurer.
    function reviewFlagged(uint256 claimId, bool clear) external onlyInsurer {
        Claim storage c = claims[claimId];
        require(c.status == Status.Flagged, "Not flagged");
        emit FlagReviewed(claimId, clear, msg.sender);
        if (clear) {
            c.status = Status.Verified;
            emit ClaimVerified(claimId);
        } else {
            _reject(claimId, msg.sender, "Rejected after manual review");
        }
    }

    /// @notice Multi-party approval: insurer and auditor must both approve; payout is automatic.
    function approveClaim(uint256 claimId) external {
        require(msg.sender == insurer || msg.sender == auditor, "Not authorised");
        Claim storage c = claims[claimId];
        require(c.status == Status.Verified, "Not ready for approval");

        if (msg.sender == insurer) {
            require(!c.insurerApproved, "Already approved");
            c.insurerApproved = true;
            emit ClaimApproved(claimId, msg.sender, "insurer");
        } else {
            require(!c.auditorApproved, "Already approved");
            c.auditorApproved = true;
            emit ClaimApproved(claimId, msg.sender, "auditor");
        }

        if (c.insurerApproved && c.auditorApproved) {
            c.status = Status.Approved;
            _payout(claimId);
        }
    }

    function rejectClaim(uint256 claimId, string calldata reason) external {
        require(msg.sender == insurer || msg.sender == auditor, "Not authorised");
        Claim storage c = claims[claimId];
        require(c.status == Status.Verified || c.status == Status.Flagged, "Cannot reject");
        _reject(claimId, msg.sender, reason);
    }

    function _payout(uint256 claimId) private {
        Claim storage c = claims[claimId];
        Policy storage p = policies[c.policyId];
        require(address(this).balance >= c.amount, "Pool underfunded");
        require(c.amount <= p.coverage - p.claimed, "Exceeds remaining coverage");
        p.claimed += c.amount;
        c.status = Status.Paid;
        (bool ok, ) = payable(c.claimant).call{value: c.amount}("");
        require(ok, "Transfer failed");
        emit PayoutExecuted(claimId, c.claimant, c.amount);
    }

    function _reject(uint256 claimId, address by, string memory reason) private {
        Claim storage c = claims[claimId];
        c.status = Status.Rejected;
        c.note = reason;
        emit ClaimRejected(claimId, by, reason);
    }
}
