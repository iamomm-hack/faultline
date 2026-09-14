use anchor_lang::prelude::*;

#[cfg(not(feature = "v2"))]
mod version_impl {
    include!("versions/v1.rs");
}
#[cfg(feature = "v2")]
mod version_impl {
    include!("versions/v2.rs");
}

declare_id!("46zDmEZAYrpwi3k6FsKFf1rPWZDbZEKM21SFzMKzb1a4");

#[program]
pub mod faultline_treasury {
    use super::*;

    pub fn initialize_version(ctx: Context<InitializeVersion>) -> Result<()> {
        write_compiled_version(&mut ctx.accounts.version_state, ctx.bumps.version_state);
        Ok(())
    }

    pub fn refresh_version(ctx: Context<RefreshVersion>) -> Result<()> {
        let bump = ctx.accounts.version_state.bump;
        write_compiled_version(&mut ctx.accounts.version_state, bump);
        Ok(())
    }
}

fn write_compiled_version(state: &mut Account<VersionState>, bump: u8) {
    state.version = version_impl::VERSION;
    state.marker = version_impl::MARKER;
    state.bump = bump;
}

#[derive(Accounts)]
pub struct InitializeVersion<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + VersionState::INIT_SPACE,
        seeds = [b"version"],
        bump
    )]
    pub version_state: Account<'info, VersionState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefreshVersion<'info> {
    #[account(mut, seeds = [b"version"], bump = version_state.bump)]
    pub version_state: Account<'info, VersionState>,
}

#[account]
#[derive(InitSpace)]
pub struct VersionState {
    pub version: u16,
    pub marker: [u8; 16],
    pub bump: u8,
}
